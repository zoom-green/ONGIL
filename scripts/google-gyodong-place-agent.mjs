import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'outputs', 'google_gyodong_places');
const publicDataDir = path.join(rootDir, 'public', 'data');

const DONGS = [
  {
    name: '\uad501\ub3d9',
    center: { lat: 37.7647632, lng: 128.8828117 },
    bounds: {
      minLat: 37.7550876,
      minLng: 128.8711851,
      maxLat: 37.7775297,
      maxLng: 128.892191,
    },
  },
  {
    name: '\uad502\ub3d9',
    center: { lat: 37.7699419, lng: 128.8942538 },
    bounds: {
      minLat: 37.7573976,
      minLng: 128.8868812,
      maxLat: 37.7834052,
      maxLng: 128.9016703,
    },
  },
];

const INCLUDED_TYPES = [
  'cafe',
  'coffee_shop',
  'restaurant',
  'bar',
  'bakery',
  'meal_takeaway',
  'meal_delivery',
  'ice_cream_shop',
  'sandwich_shop',
  'pizza_restaurant',
  'hamburger_restaurant',
  'korean_restaurant',
  'japanese_restaurant',
  'chinese_restaurant',
  'american_restaurant',
  'fast_food_restaurant',
];

const FOOD_TYPES = new Set([
  'restaurant',
  'bar',
  'bakery',
  'meal_takeaway',
  'meal_delivery',
  'ice_cream_shop',
  'sandwich_shop',
  'pizza_restaurant',
  'hamburger_restaurant',
  'korean_restaurant',
  'japanese_restaurant',
  'chinese_restaurant',
  'american_restaurant',
  'fast_food_restaurant',
]);

const GRID = { lat: 0.00105, lng: 0.00125 };
const SEARCH_RADIUS_M = 95;
const REFINE_RADIUS_M = 58;
const DEEP_REFINE_RADIUS_M = 32;
const REQUEST_DELAY_MS = 220;
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
  let fileEnv = {};
  try {
    fileEnv = loadEnv(await fs.readFile(path.join(rootDir, '.env'), 'utf8'));
  } catch {}
  const key = process.env.GOOGLE_MAPS_API_KEY
    || process.env.VITE_GOOGLE_MAPS_API_KEY
    || fileEnv.GOOGLE_MAPS_API_KEY
    || fileEnv.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is missing.');
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

function buildGrid() {
  const cells = [];
  for (const dong of DONGS) {
    let index = 1;
    for (let lat = dong.bounds.minLat; lat <= dong.bounds.maxLat; lat += GRID.lat) {
      for (let lng = dong.bounds.minLng; lng <= dong.bounds.maxLng; lng += GRID.lng) {
        cells.push({
          dong: dong.name,
          id: `${dong.name}-${String(index).padStart(4, '0')}`,
          center: { lat, lng },
        });
        index += 1;
      }
    }
  }
  return cells;
}

async function nearbySearch(cell, key) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.primaryType',
          'places.types',
          'places.location',
          'places.businessStatus',
          'places.regularOpeningHours',
          'places.googleMapsUri',
          'places.formattedAddress',
        ].join(','),
      },
      body: JSON.stringify({
        includedTypes: INCLUDED_TYPES,
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: {
              latitude: cell.center.lat,
              longitude: cell.center.lng,
            },
            radius: cell.radius ?? SEARCH_RADIUS_M,
          },
        },
      }),
    });
    const text = await response.text();
    await sleep(REQUEST_DELAY_MS * attempt);
    if (response.ok) return JSON.parse(text);
    lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    if (response.status === 429) {
      await sleep(2500 * attempt);
      continue;
    }
    break;
  }
  throw lastError;
}

function inBounds(place, dong) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= dong.bounds.minLat && lat <= dong.bounds.maxLat && lng >= dong.bounds.minLng && lng <= dong.bounds.maxLng;
}

function distanceSq(a, b) {
  return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
}

function assignDong(place) {
  const matches = DONGS.filter((dong) => inBounds(place, dong));
  if (matches.length === 1) return matches[0].name;
  if (matches.length > 1) {
    const point = { lat: place.location.latitude, lng: place.location.longitude };
    return matches.sort((a, b) => distanceSq(point, a.center) - distanceSq(point, b.center))[0].name;
  }
  return null;
}

function categoryFrom(place) {
  const types = new Set(place.types ?? []);
  if (place.primaryType === 'cafe' || place.primaryType === 'coffee_shop' || types.has('cafe') || types.has('coffee_shop')) return 'cafe';
  if (place.primaryType === 'bakery' || types.has('bakery') || place.primaryType === 'ice_cream_shop' || types.has('ice_cream_shop')) return 'cafe';
  if (FOOD_TYPES.has(place.primaryType) || [...types].some((type) => FOOD_TYPES.has(type))) return 'restaurant';
  return null;
}

function isUnmanned(place) {
  const name = place.displayName?.text ?? '';
  return /\ubb34\uc778|\uc140\ud504\s*\uce74\ud398|\ubb34\uc778\uce74\ud398|\ubb34\uc778\ucee4\ud53c|\ubb34\uc778\ub9e4\uc7a5|\ubb34\uc778\uc810\ud3ec/i.test(name);
}

function formatClock(dayTime) {
  if (!dayTime) return '';
  const hour = String(dayTime.hour ?? 0).padStart(2, '0');
  const minute = String(dayTime.minute ?? 0).padStart(2, '0');
  return `${hour}:${minute}`;
}

function emptyWeeklyHours() {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

function parseOpeningHours(regularOpeningHours) {
  const weekly = emptyWeeklyHours();
  for (const period of regularOpeningHours?.periods ?? []) {
    const openDay = period.open?.day;
    const closeDay = period.close?.day;
    const open = formatClock(period.open);
    let close = formatClock(period.close);
    if (!Number.isInteger(openDay) || !open) continue;
    if (!close) close = '24:00';
    if (close === '00:00' && Number.isInteger(closeDay) && closeDay !== openDay) close = '24:00';
    weekly[DAYS[openDay]]?.push({ open, close });
  }
  return weekly;
}

function hasHours(weekly) {
  return Object.values(weekly).some((entries) => entries.length > 0);
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
  const cells = buildGrid();
  const stats = {
    started_at: new Date().toISOString(),
    source: 'google_places_api_new_nearby_search',
    included_types: INCLUDED_TYPES,
    search_radius_m: SEARCH_RADIUS_M,
    grid: GRID,
    target_admin_dongs: DONGS.map((dong) => dong.name),
    grid_cell_count: cells.length,
    capped_cells: [],
    refined_cell_count: 0,
    refined_capped_cells: [],
    deep_refined_cell_count: 0,
    deep_refined_capped_cells: [],
  };

  const rawBatches = await mapLimit(cells, CONCURRENCY, async (cell, index) => {
    try {
      const data = await nearbySearch(cell, key);
      const places = (data.places ?? []).map((place) => ({ ...place, _cellId: cell.id, _cellDong: cell.dong }));
      if (places.length >= 20) stats.capped_cells.push(cell.id);
      if ((index + 1) % 50 === 0) process.stdout.write(`g${index + 1} `);
      return places;
    } catch (error) {
      return [{ _error: error instanceof Error ? error.message : String(error), _cellId: cell.id, _cellDong: cell.dong }];
    }
  });
  process.stdout.write('\n');

  let raw = rawBatches.flat();
  if (stats.capped_cells.length > 0) {
    const cappedSet = new Set(stats.capped_cells);
    const refineCells = cells
      .filter((cell) => cappedSet.has(cell.id))
      .flatMap((cell) => {
        const offsets = [
          [-GRID.lat / 4, -GRID.lng / 4],
          [-GRID.lat / 4, GRID.lng / 4],
          [GRID.lat / 4, -GRID.lng / 4],
          [GRID.lat / 4, GRID.lng / 4],
        ];
        return offsets.map(([latOffset, lngOffset], index) => ({
          dong: cell.dong,
          id: `${cell.id}-refine-${index + 1}`,
          center: { lat: cell.center.lat + latOffset, lng: cell.center.lng + lngOffset },
          radius: REFINE_RADIUS_M,
          refined: true,
        }));
      });
    stats.refined_cell_count = refineCells.length;
    const refinedBatches = await mapLimit(refineCells, CONCURRENCY, async (cell, index) => {
      try {
        const data = await nearbySearch(cell, key);
        const places = (data.places ?? []).map((place) => ({ ...place, _cellId: cell.id, _cellDong: cell.dong, _refined: true }));
        if (places.length >= 20) stats.refined_capped_cells.push(cell.id);
        if ((index + 1) % 50 === 0) process.stdout.write(`r${index + 1} `);
        return places;
      } catch (error) {
        return [{ _error: error instanceof Error ? error.message : String(error), _cellId: cell.id, _cellDong: cell.dong, _refined: true }];
      }
    });
    process.stdout.write('\n');
    raw = raw.concat(refinedBatches.flat());

    if (stats.refined_capped_cells.length > 0) {
      const refinedCappedSet = new Set(stats.refined_capped_cells);
      const deepRefineCells = refineCells
        .filter((cell) => refinedCappedSet.has(cell.id))
        .flatMap((cell) => {
          const offsets = [
            [-GRID.lat / 8, -GRID.lng / 8],
            [-GRID.lat / 8, GRID.lng / 8],
            [GRID.lat / 8, -GRID.lng / 8],
            [GRID.lat / 8, GRID.lng / 8],
          ];
          return offsets.map(([latOffset, lngOffset], index) => ({
            dong: cell.dong,
            id: `${cell.id}-deep-${index + 1}`,
            center: { lat: cell.center.lat + latOffset, lng: cell.center.lng + lngOffset },
            radius: DEEP_REFINE_RADIUS_M,
            refined: true,
          }));
        });
      stats.deep_refined_cell_count = deepRefineCells.length;
      const deepBatches = await mapLimit(deepRefineCells, CONCURRENCY, async (cell, index) => {
        try {
          const data = await nearbySearch(cell, key);
          const places = (data.places ?? []).map((place) => ({ ...place, _cellId: cell.id, _cellDong: cell.dong, _refined: true, _deepRefined: true }));
          if (places.length >= 20) stats.deep_refined_capped_cells.push(cell.id);
          if ((index + 1) % 50 === 0) process.stdout.write(`d${index + 1} `);
          return places;
        } catch (error) {
          return [{ _error: error instanceof Error ? error.message : String(error), _cellId: cell.id, _cellDong: cell.dong, _deepRefined: true }];
        }
      });
      process.stdout.write('\n');
      raw = raw.concat(deepBatches.flat());
    }
  }
  const errors = raw.filter((item) => item._error);
  const candidates = raw.filter((item) => !item._error);
  const byId = new Map();
  for (const place of candidates) {
    if (!byId.has(place.id)) byId.set(place.id, place);
  }

  const today = todayKst();
  const places = [...byId.values()]
    .map((place) => {
      const adminDong = assignDong(place);
      const category = categoryFrom(place);
      if (!adminDong || !category || isUnmanned(place)) return null;
      const weeklyHours = parseOpeningHours(place.regularOpeningHours);
      const collected = hasHours(weeklyHours);
      return {
        place_id: `google_${place.id}`,
        google_place_id: place.id,
        name: place.displayName?.text ?? '',
        category,
        google_primary_type: place.primaryType ?? '',
        google_types: place.types ?? [],
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        address: place.formattedAddress ?? '',
        admin_dong: adminDong,
        survey_zone: adminDong,
        weekly_hours: weeklyHours,
        weekday_descriptions: place.regularOpeningHours?.weekdayDescriptions ?? [],
        regular_holiday: [],
        business_status: place.businessStatus === 'OPERATIONAL' ? 'active' : String(place.businessStatus ?? 'unknown').toLowerCase(),
        confidence: collected ? 'estimated' : 'unverified',
        last_verified_at: today,
        source_url: place.googleMapsUri ?? '',
        source: 'google_places_api',
        source_cell_id: place._cellId,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.admin_dong.localeCompare(b.admin_dong, 'ko') || a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ko'));

  const metadata = {
    ...stats,
    finished_at: new Date().toISOString(),
    raw_result_count: candidates.length,
    unique_google_place_count: byId.size,
    final_count: places.length,
    cafe_count: places.filter((place) => place.category === 'cafe').length,
    restaurant_count: places.filter((place) => place.category === 'restaurant').length,
    hours_collected_count: places.filter((place) => place.confidence === 'estimated').length,
    hours_unavailable_count: places.filter((place) => place.confidence !== 'estimated').length,
    error_count: errors.length,
    capped_cell_count: stats.capped_cells.length,
    runtime_api_use: 'none - app reads this saved JSON only',
  };

  const full = { metadata, places };
  const safeRoute = {
    metadata,
    places: places.map((place) => ({
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
    })),
  };

  await fs.writeFile(path.join(outputDir, 'gangneung_gyodong_google_places_full.json'), JSON.stringify(full, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, 'gangneung_gyodong_google_safe_route_places.json'), JSON.stringify(safeRoute, null, 2), 'utf8');
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
