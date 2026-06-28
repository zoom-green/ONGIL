import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'outputs', 'gyodong_food_places');
const publicDataDir = path.join(rootDir, 'public', 'data');

const CATEGORY_CODES = [
  { code: 'CE7', category: 'cafe' },
  { code: 'FD6', category: 'restaurant' },
];

const SEARCH_BOUNDS = {
  minLng: 128.845,
  minLat: 37.735,
  maxLng: 128.925,
  maxLat: 37.800,
};

const GRID = { lng: 0.004, lat: 0.003 };
const MIN_GRID = { lng: 0.001, lat: 0.00075 };
const HIGH_DENSITY_COUNT = 42;
const REQUEST_DELAY_MS = 70;
const CONCURRENCY = 8;

const GANGNEUNG = '\uac15\ub989\uc2dc';
const TARGET_DONGS = new Set(['\uad501\ub3d9', '\uad502\ub3d9']);
const DAY_MAP = new Map([
  ['\uc6d4', 'mon'],
  ['\ud654', 'tue'],
  ['\uc218', 'wed'],
  ['\ubaa9', 'thu'],
  ['\uae08', 'fri'],
  ['\ud1a0', 'sat'],
  ['\uc77c', 'sun'],
]);

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

async function getKakaoKey() {
  const env = loadEnv(await fs.readFile(path.join(rootDir, '.env'), 'utf8'));
  const key = env.VITE_KAKAO_REST_KEY || process.env.VITE_KAKAO_REST_KEY;
  if (!key) throw new Error('VITE_KAKAO_REST_KEY is missing.');
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

function rectParam(rect) {
  return [rect.minLng, rect.minLat, rect.maxLng, rect.maxLat].map((v) => v.toFixed(7)).join(',');
}

function splitRect(rect) {
  const midLng = (rect.minLng + rect.maxLng) / 2;
  const midLat = (rect.minLat + rect.maxLat) / 2;
  return [
    { minLng: rect.minLng, minLat: rect.minLat, maxLng: midLng, maxLat: midLat },
    { minLng: midLng, minLat: rect.minLat, maxLng: rect.maxLng, maxLat: midLat },
    { minLng: rect.minLng, minLat: midLat, maxLng: midLng, maxLat: rect.maxLat },
    { minLng: midLng, minLat: midLat, maxLng: rect.maxLng, maxLat: rect.maxLat },
  ];
}

function canSplit(rect) {
  return (rect.maxLng - rect.minLng) > MIN_GRID.lng && (rect.maxLat - rect.minLat) > MIN_GRID.lat;
}

function buildRects() {
  const rects = [];
  let index = 1;
  for (let minLat = SEARCH_BOUNDS.minLat; minLat < SEARCH_BOUNDS.maxLat; minLat += GRID.lat) {
    for (let minLng = SEARCH_BOUNDS.minLng; minLng < SEARCH_BOUNDS.maxLng; minLng += GRID.lng) {
      rects.push({
        id: `R${String(index).padStart(4, '0')}`,
        minLng,
        minLat,
        maxLng: Math.min(minLng + GRID.lng, SEARCH_BOUNDS.maxLng),
        maxLat: Math.min(minLat + GRID.lat, SEARCH_BOUNDS.maxLat),
      });
      index += 1;
    }
  }
  return rects;
}

async function kakaoLocalGet(url, key) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
      const text = await response.text();
      await sleep(REQUEST_DELAY_MS * attempt);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await sleep(REQUEST_DELAY_MS * attempt * 4);
    }
  }
  throw lastError;
}

async function searchRect(category, rect, key, gridId, stats, depth = 0) {
  const params = new URLSearchParams({
    category_group_code: category.code,
    rect: rectParam(rect),
    size: '15',
    page: '1',
    sort: 'accuracy',
  });
  const first = await kakaoLocalGet(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, key);
  const pageableCount = Number(first?.meta?.pageable_count ?? 0);
  const totalCount = Number(first?.meta?.total_count ?? 0);
  stats.gridSearches.push({
    grid_id: gridId,
    category: category.category,
    depth,
    rect: rectParam(rect),
    pageable_count: pageableCount,
    total_count: totalCount,
    subdivided: false,
  });

  if (pageableCount >= HIGH_DENSITY_COUNT && canSplit(rect)) {
    stats.gridSearches[stats.gridSearches.length - 1].subdivided = true;
    const childResults = [];
    for (const [childIndex, child] of splitRect(rect).entries()) {
      childResults.push(...await searchRect(category, child, key, `${gridId}-${childIndex + 1}`, stats, depth + 1));
    }
    return childResults;
  }

  const docs = (first.documents ?? []).map((doc) => ({ ...doc, _category: category.category, _gridId: gridId }));
  const pageCount = Math.ceil(pageableCount / 15);
  for (let page = 2; page <= pageCount; page += 1) {
    const pageParams = new URLSearchParams({
      category_group_code: category.code,
      rect: rectParam(rect),
      size: '15',
      page: String(page),
      sort: 'accuracy',
    });
    const data = await kakaoLocalGet(`https://dapi.kakao.com/v2/local/search/category.json?${pageParams}`, key);
    docs.push(...(data.documents ?? []).map((doc) => ({ ...doc, _category: category.category, _gridId: gridId })));
    if (data?.meta?.is_end) break;
  }
  return docs;
}

async function getAdminDong(lng, lat, key, cache) {
  const cacheKey = `${Number(lng).toFixed(5)},${Number(lat).toFixed(5)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const params = new URLSearchParams({ x: String(lng), y: String(lat) });
  const data = await kakaoLocalGet(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?${params}`, key);
  const admin = (data.documents ?? []).find((doc) => doc.region_type === 'H') ?? null;
  const result = {
    city: admin?.region_2depth_name ?? '',
    admin_dong: admin?.region_3depth_h_name ?? admin?.region_3depth_name ?? '',
  };
  cache.set(cacheKey, result);
  return result;
}

async function fetchPanel(placeId) {
  const url = `https://place-api.map.kakao.com/places/panel3/${placeId}`;
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json, text/plain, */*',
          Referer: `https://place.map.kakao.com/${placeId}`,
          pf: 'PC',
          appVersion: '6.6.0',
        },
      });
      const text = await response.text();
      await sleep(REQUEST_DELAY_MS * attempt);
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      return { ok: true, panel: JSON.parse(text), error: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(REQUEST_DELAY_MS * attempt * 3);
    }
  }
  return { ok: false, panel: null, error: lastError };
}

function emptyWeeklyHours() {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

function parseDayKey(dayDesc = '') {
  const match = dayDesc.match(/[\uc6d4\ud654\uc218\ubaa9\uae08\ud1a0\uc77c]/);
  return match ? DAY_MAP.get(match[0]) : null;
}

function parseRanges(desc = '') {
  if (!desc || /\ud734\ubb34|\uc26c\ub294/.test(desc)) return [];
  if (/24\uc2dc\uac04|00:00\s*~\s*24:00|00:00\s*~\s*00:00/.test(desc)) return [{ open: '00:00', close: '24:00' }];
  const result = [];
  const regex = /(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2}|24:00)/g;
  let match;
  while ((match = regex.exec(desc))) {
    result.push({ open: match[1].padStart(5, '0'), close: match[2].padStart(5, '0') });
  }
  return result;
}

function parseOpenHours(openHours) {
  const weekly = emptyWeeklyHours();
  const holidays = [];
  for (const period of openHours?.week_from_today?.week_periods ?? []) {
    for (const day of period.days ?? []) {
      const key = parseDayKey(day.day_of_the_week_desc);
      if (!key) continue;
      const desc = day.on_days?.start_end_time_desc || day.on_days?.time_desc || '';
      const offDesc = day.off_days?.desc || day.off_days?.display_text || '';
      const ranges = parseRanges(desc);
      if (ranges.length) weekly[key].push(...ranges);
      if (offDesc || /\ud734\ubb34/.test(desc)) holidays.push(day.day_of_the_week_desc);
    }
  }
  const holidayDesc = openHours?.headline_addition?.days_off_desc || openHours?.week_from_today?.days_off_desc || '';
  if (holidayDesc) holidays.push(holidayDesc);
  return {
    weekly,
    regular_holiday: [...new Set(holidays)].filter(Boolean),
    headline: openHours?.headline ?? null,
  };
}

function isUnmanned(doc, panel) {
  const text = [
    doc.place_name,
    doc.category_name,
    panel?.summary?.name,
    panel?.summary?.category?.name,
    panel?.summary?.category?.name1,
    panel?.summary?.category?.name2,
    panel?.summary?.category?.name3,
  ].filter(Boolean).join(' ');
  return /\ubb34\uc778|\uc140\ud504\s*\uce74\ud398|\ubb34\uc778\uce74\ud398|\ubb34\uc778\ucee4\ud53c|\ubb34\uc778\ub9e4\uc7a5|\ubb34\uc778\uc810\ud3ec/i.test(text);
}

function businessStatus(summary) {
  if (summary?.status === 'Y') return 'active';
  if (summary?.status === 'N') return 'closed_or_inactive';
  return 'unknown';
}

function categoryFrom(doc, panel) {
  const text = `${doc._category} ${doc.category_name ?? ''} ${panel?.summary?.category?.name ?? ''}`;
  if (doc._category === 'cafe' || /\uce74\ud398|\ucee4\ud53c/.test(text)) return 'cafe';
  return 'restaurant';
}

function normalizeText(value = '') {
  return value.replace(/\s+/g, '').replace(/[-,._()]/g, '').toLowerCase();
}

function dedupePlaces(places) {
  const byId = new Map();
  for (const place of places) {
    if (place.kakao_id && !byId.has(place.kakao_id)) byId.set(place.kakao_id, place);
  }
  const merged = [...byId.values()];
  return merged.reduce((acc, place) => {
    const duplicate = acc.find((existing) => {
      if (existing.admin_dong !== place.admin_dong) return false;
      if (normalizeText(existing.address) && normalizeText(existing.address) === normalizeText(place.address)) return true;
      const sameName = normalizeText(existing.name) && normalizeText(existing.name) === normalizeText(place.name);
      const dLat = existing.lat - place.lat;
      const dLng = existing.lng - place.lng;
      return sameName && Math.sqrt(dLat * dLat + dLng * dLng) < 0.0008;
    });
    if (!duplicate) acc.push(place);
    return acc;
  }, []);
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
  const key = await getKakaoKey();
  const stats = { started_at: new Date().toISOString(), gridSearches: [] };
  const rects = buildRects();
  const raw = [];
  for (const category of CATEGORY_CODES) {
    for (const rect of rects) {
      raw.push(...await searchRect(category, rect, key, rect.id, stats));
      process.stdout.write('.');
    }
    process.stdout.write(` ${category.category}\n`);
  }

  const candidates = [...new Map(raw.map((doc) => [doc.id, doc])).values()];
  const regionCache = new Map();
  const regionChecked = await mapLimit(candidates, CONCURRENCY, async (doc, index) => {
    const lat = Number(doc.y);
    const lng = Number(doc.x);
    const region = await getAdminDong(lng, lat, key, regionCache);
    if ((index + 1) % 100 === 0) process.stdout.write(`r${index + 1} `);
    return { doc, lat, lng, region };
  });
  process.stdout.write('\n');

  const target = regionChecked.filter((item) => item.region.city === GANGNEUNG && TARGET_DONGS.has(item.region.admin_dong));
  const today = todayKst();
  const enriched = await mapLimit(target, CONCURRENCY, async ({ doc, lat, lng, region }, index) => {
    const panelResult = await fetchPanel(doc.id);
    const panel = panelResult.panel;
    if ((index + 1) % 50 === 0) process.stdout.write(`d${index + 1} `);
    if (isUnmanned(doc, panel)) return null;
    const hours = parseOpenHours(panel?.open_hours);
    const hasHours = Object.values(hours.weekly).some((entries) => entries.length > 0);
    const summary = panel?.summary ?? {};
    const placeUrl = `https://place.map.kakao.com/${doc.id}`;
    return {
      place_id: `kakao_${doc.id}`,
      kakao_id: doc.id,
      name: summary.name || doc.place_name || '',
      category: categoryFrom(doc, panel),
      kakao_category_name: doc.category_name || summary.category?.name || '',
      address: summary.address?.jibun ? `\uac15\uc6d0\ud2b9\ubcc4\uc790\uce58\ub3c4 \uac15\ub989\uc2dc ${summary.address.jibun}` : doc.address_name || '',
      road_address: summary.address?.road || doc.road_address_name || '',
      lat: summary.point?.lat ?? lat,
      lng: summary.point?.lon ?? lng,
      admin_dong: region.admin_dong,
      survey_zone: region.admin_dong,
      weekly_hours: hours.weekly,
      regular_holiday: hours.regular_holiday,
      business_status: businessStatus(summary),
      confidence: hasHours ? 'estimated' : 'unverified',
      last_verified_at: today,
      source_url: placeUrl,
      source: 'kakao_place_panel3',
      source_grid_id: doc._gridId,
      notes: hasHours ? 'Kakao place data parsed automatically' : 'Hours unavailable from Kakao place data',
      open_hours_headline: hours.headline,
    };
  });
  process.stdout.write('\n');

  const places = dedupePlaces(enriched.filter(Boolean))
    .filter((place) => place.business_status !== 'closed_or_inactive')
    .sort((a, b) => a.admin_dong.localeCompare(b.admin_dong, 'ko') || a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ko'));

  const metadata = {
    ...stats,
    finished_at: new Date().toISOString(),
    target_admin_dongs: [...TARGET_DONGS],
    raw_document_count: raw.length,
    unique_candidate_count: candidates.length,
    target_candidate_count: target.length,
    final_count: places.length,
    cafe_count: places.filter((place) => place.category === 'cafe').length,
    restaurant_count: places.filter((place) => place.category === 'restaurant').length,
    hours_collected_count: places.filter((place) => place.confidence === 'estimated').length,
    hours_unavailable_count: places.filter((place) => place.confidence !== 'estimated').length,
    unmanned_excluded: target.length - enriched.filter(Boolean).length,
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

  await fs.writeFile(path.join(outputDir, 'gangneung_gyodong_food_places_full.json'), JSON.stringify(full, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, 'gangneung_gyodong_food_safe_route_places.json'), JSON.stringify(safeRoute, null, 2), 'utf8');
  await fs.writeFile(path.join(publicDataDir, 'gangneung_gyodong_food_safe_route_places.json'), JSON.stringify(safeRoute, null, 2), 'utf8');
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
