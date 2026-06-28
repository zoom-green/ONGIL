import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'outputs', 'gyodong_food_places');
const publicDataDir = path.join(rootDir, 'public', 'data');
const sourcePath = path.join(outputDir, 'gangneung_gyodong_food_places_full.json');

const REQUEST_DELAY_MS = 120;
const CONCURRENCY = 3;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function getGoogleKey() {
  const envPath = path.join(rootDir, '.env');
  let fileEnv = {};
  try {
    fileEnv = loadEnv(await fs.readFile(envPath, 'utf8'));
  } catch {}
  const key = process.env.GOOGLE_MAPS_API_KEY
    || process.env.VITE_GOOGLE_MAPS_API_KEY
    || fileEnv.GOOGLE_MAPS_API_KEY
    || fileEnv.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is missing. Set it in the environment before running this script.');
  return key;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function googleGet(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      await sleep(REQUEST_DELAY_MS * attempt);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) {
        throw new Error(`${data.status}: ${data.error_message ?? 'no error message'}`);
      }
      return data;
    } catch (error) {
      lastError = error;
      await sleep(REQUEST_DELAY_MS * attempt * 5);
    }
  }
  throw lastError;
}

function emptyWeeklyHours() {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

function formatGoogleTime(value) {
  if (!value || value.length !== 4) return '';
  return `${value.slice(0, 2)}:${value.slice(2)}`;
}

function parseGoogleOpeningHours(openingHours) {
  const weekly = emptyWeeklyHours();
  for (const period of openingHours?.periods ?? []) {
    const openDay = period.open?.day;
    const openTime = formatGoogleTime(period.open?.time);
    const closeDay = period.close?.day;
    const closeTime = formatGoogleTime(period.close?.time);
    if (!Number.isInteger(openDay) || !openTime) continue;
    const key = DAYS[openDay];
    if (!key) continue;
    if (!period.close) {
      weekly[key].push({ open: openTime, close: '24:00' });
      continue;
    }
    const close = closeTime || '24:00';
    weekly[key].push({ open: openTime, close: close === '00:00' && closeDay !== openDay ? '24:00' : close });
  }
  return weekly;
}

function hasHours(weekly) {
  return Object.values(weekly).some((entries) => entries.length > 0);
}

function normalize(value = '') {
  return value.replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function candidateLooksRelevant(place, result) {
  const sourceName = normalize(place.name);
  const resultName = normalize(result.name);
  if (!sourceName || !resultName) return false;
  if (sourceName === resultName || sourceName.includes(resultName) || resultName.includes(sourceName)) return true;
  const location = result.geometry?.location;
  if (!location) return false;
  const dLat = Number(location.lat) - Number(place.lat);
  const dLng = Number(location.lng) - Number(place.lng);
  return Math.sqrt(dLat * dLat + dLng * dLng) < 0.0012;
}

async function textSearch(place, key) {
  const query = `${place.name} 강릉 ${place.admin_dong ?? ''}`.trim();
  const params = new URLSearchParams({
    query,
    location: `${place.lat},${place.lng}`,
    radius: '250',
    language: 'ko',
    key,
  });
  const data = await googleGet(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
  const results = data.results ?? [];
  return results.find((result) => candidateLooksRelevant(place, result)) ?? results[0] ?? null;
}

async function placeDetails(placeId, key) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'place_id,name,business_status,formatted_address,geometry,opening_hours,url',
    language: 'ko',
    key,
  });
  const data = await googleGet(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  return data.result ?? null;
}

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(publicDataDir, { recursive: true });
  const key = await getGoogleKey();
  const data = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const today = todayKst();
  const places = data.places ?? [];
  const needsGoogle = places.filter((place) => place.confidence !== 'estimated');
  const googleResults = await mapLimit(needsGoogle, CONCURRENCY, async (place, index) => {
    try {
      const found = await textSearch(place, key);
      if (!found?.place_id) return { place_id: place.place_id, google_status: 'not_found' };
      const details = await placeDetails(found.place_id, key);
      const weekly = parseGoogleOpeningHours(details?.opening_hours);
      const collected = hasHours(weekly);
      if ((index + 1) % 10 === 0) process.stdout.write(`g${index + 1} `);
      return {
        place_id: place.place_id,
        google_status: collected ? 'hours_collected' : 'no_hours',
        google_place_id: found.place_id,
        google_name: details?.name ?? found.name ?? '',
        google_business_status: details?.business_status ?? found.business_status ?? '',
        google_url: details?.url ?? '',
        google_weekday_text: details?.opening_hours?.weekday_text ?? [],
        weekly_hours: weekly,
      };
    } catch (error) {
      return {
        place_id: place.place_id,
        google_status: 'error',
        google_error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  process.stdout.write('\n');

  const resultById = new Map(googleResults.map((item) => [item.place_id, item]));
  const enrichedPlaces = places.map((place) => {
    const google = resultById.get(place.place_id);
    if (!google || google.google_status !== 'hours_collected') {
      return google ? { ...place, google_enrichment: google } : place;
    }
    return {
      ...place,
      weekly_hours: google.weekly_hours,
      confidence: 'estimated',
      last_verified_at: today,
      source: `${place.source}+google_places`,
      source_url: place.source_url,
      google_enrichment: google,
    };
  });

  const metadata = {
    ...data.metadata,
    google_enriched_at: new Date().toISOString(),
    google_checked_count: needsGoogle.length,
    google_hours_collected_count: googleResults.filter((item) => item.google_status === 'hours_collected').length,
    google_not_found_count: googleResults.filter((item) => item.google_status === 'not_found').length,
    google_no_hours_count: googleResults.filter((item) => item.google_status === 'no_hours').length,
    google_error_count: googleResults.filter((item) => item.google_status === 'error').length,
  };
  metadata.hours_collected_count = enrichedPlaces.filter((place) => place.confidence === 'estimated').length;
  metadata.hours_unavailable_count = enrichedPlaces.length - metadata.hours_collected_count;

  const full = { metadata, places: enrichedPlaces };
  const safeRoute = {
    metadata,
    places: enrichedPlaces.map((place) => ({
      place_id: place.place_id,
      name: place.name,
      category: place.category,
      lat: place.lat,
      lng: place.lng,
      admin_dong: place.admin_dong,
      survey_zone: place.survey_zone,
      weekly_hours: place.weekly_hours,
      regular_holiday: place.regular_holiday,
      business_status: place.business_status,
      confidence: place.confidence,
      last_verified_at: place.last_verified_at,
      source_url: place.source_url,
      google_enrichment: place.google_enrichment,
    })),
  };

  await fs.writeFile(path.join(outputDir, 'gangneung_gyodong_food_places_google_enriched.json'), JSON.stringify(full, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, 'gangneung_gyodong_food_safe_route_places_google_enriched.json'), JSON.stringify(safeRoute, null, 2), 'utf8');
  await fs.writeFile(path.join(publicDataDir, 'gangneung_gyodong_food_safe_route_places.json'), JSON.stringify(safeRoute, null, 2), 'utf8');
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
