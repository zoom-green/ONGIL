import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'outputs', 'kakao_gyo1_places');

const CATEGORY_CODES = [
  { code: 'CE7', label: 'cafe', kakaoLabel: '카페' },
  { code: 'FD6', label: 'restaurant', kakaoLabel: '음식점' },
];

// Broad search envelope around Gangneung Gyo-dong. Final inclusion is filtered
// by Kakao reverse geocoding's administrative dong name: region_3depth_h_name.
const SEARCH_BOUNDS = {
  minLng: 128.845,
  minLat: 37.735,
  maxLng: 128.925,
  maxLat: 37.790,
};

const INITIAL_GRID_DEGREES = {
  lng: 0.006,
  lat: 0.0045,
};

const MIN_GRID_DEGREES = {
  lng: 0.0015,
  lat: 0.001125,
};

const HIGH_DENSITY_PAGEABLE_COUNT = 42;
const REQUEST_DELAY_MS = 35;
const MAX_RETRIES = 3;
const DETAIL_CONCURRENCY = 8;

const SURVEY_ZONES = [
  {
    id: 'G1-01',
    name: '강릉원주대 정문/대학가',
    center: { lat: 37.7702, lng: 128.8708 },
  },
  {
    id: 'G1-02',
    name: '강릉원주대 후문/원룸촌',
    center: { lat: 37.7738, lng: 128.8743 },
  },
  {
    id: 'G1-03',
    name: '교동택지 중심상권',
    center: { lat: 37.7627, lng: 128.8768 },
  },
  {
    id: 'G1-04',
    name: '교동택지 주거지 인접',
    center: { lat: 37.7595, lng: 128.8832 },
  },
  {
    id: 'G1-05',
    name: '대로변 상권',
    center: { lat: 37.7566, lng: 128.8717 },
  },
  {
    id: 'G1-06',
    name: '교1동 외곽/저밀도',
    center: { lat: 37.7754, lng: 128.886 },
  },
];

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const KR_DAY_TO_INDEX = new Map([
  ['일', 0],
  ['월', 1],
  ['화', 2],
  ['수', 3],
  ['목', 4],
  ['금', 5],
  ['토', 6],
]);

function loadEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function getKakaoRestKey() {
  const envPath = path.join(rootDir, '.env');
  const env = loadEnv(await fs.readFile(envPath, 'utf8'));
  const key = env.VITE_KAKAO_REST_KEY || process.env.VITE_KAKAO_REST_KEY || process.env.KAKAO_REST_KEY;
  if (!key) {
    throw new Error('VITE_KAKAO_REST_KEY is missing in .env');
  }
  return key;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function rectToParam(rect) {
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
  return (rect.maxLng - rect.minLng) > MIN_GRID_DEGREES.lng && (rect.maxLat - rect.minLat) > MIN_GRID_DEGREES.lat;
}

function buildInitialRects() {
  const rects = [];
  let index = 1;
  for (let minLat = SEARCH_BOUNDS.minLat; minLat < SEARCH_BOUNDS.maxLat; minLat += INITIAL_GRID_DEGREES.lat) {
    for (let minLng = SEARCH_BOUNDS.minLng; minLng < SEARCH_BOUNDS.maxLng; minLng += INITIAL_GRID_DEGREES.lng) {
      rects.push({
        id: `R${String(index).padStart(3, '0')}`,
        minLng,
        minLat,
        maxLng: Math.min(minLng + INITIAL_GRID_DEGREES.lng, SEARCH_BOUNDS.maxLng),
        maxLat: Math.min(minLat + INITIAL_GRID_DEGREES.lat, SEARCH_BOUNDS.maxLat),
      });
      index += 1;
    }
  }
  return rects;
}

async function kakaoGet(url, key) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `KakaoAK ${key}` },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
      }
      await sleep(REQUEST_DELAY_MS);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await sleep(REQUEST_DELAY_MS * attempt * 2);
    }
  }
  throw lastError;
}

async function searchCategoryInRect(category, rect, key, gridId, depth = 0, stats) {
  const collected = [];
  const firstParams = new URLSearchParams({
    category_group_code: category.code,
    rect: rectToParam(rect),
    size: '15',
    page: '1',
    sort: 'accuracy',
  });
  const firstUrl = `https://dapi.kakao.com/v2/local/search/category.json?${firstParams}`;
  const first = await kakaoGet(firstUrl, key);
  const pageableCount = Number(first?.meta?.pageable_count ?? 0);
  const totalCount = Number(first?.meta?.total_count ?? 0);

  stats.gridSearches.push({
    grid_id: gridId,
    category: category.label,
    depth,
    rect: rectToParam(rect),
    pageable_count: pageableCount,
    total_count: totalCount,
    subdivided: false,
  });

  if (pageableCount >= HIGH_DENSITY_PAGEABLE_COUNT && canSplit(rect)) {
    stats.gridSearches[stats.gridSearches.length - 1].subdivided = true;
    const children = splitRect(rect);
    for (let i = 0; i < children.length; i += 1) {
      const childId = `${gridId}-${i + 1}`;
      const childResults = await searchCategoryInRect(category, children[i], key, childId, depth + 1, stats);
      collected.push(...childResults);
    }
    return collected;
  }

  const pageCount = Math.max(1, Math.ceil(pageableCount / 15));
  collected.push(...(first.documents ?? []).map((doc) => ({ ...doc, _gridId: gridId, _rect: rectToParam(rect), _categoryLabel: category.label })));

  for (let page = 2; page <= pageCount; page += 1) {
    const params = new URLSearchParams({
      category_group_code: category.code,
      rect: rectToParam(rect),
      size: '15',
      page: String(page),
      sort: 'accuracy',
    });
    const url = `https://dapi.kakao.com/v2/local/search/category.json?${params}`;
    const data = await kakaoGet(url, key);
    collected.push(...(data.documents ?? []).map((doc) => ({ ...doc, _gridId: gridId, _rect: rectToParam(rect), _categoryLabel: category.label })));
    if (data?.meta?.is_end) break;
  }

  return collected;
}

async function getAdminDong(lng, lat, key, cache) {
  const cacheKey = `${Number(lng).toFixed(5)},${Number(lat).toFixed(5)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const params = new URLSearchParams({ x: String(lng), y: String(lat) });
  const url = `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?${params}`;
  const data = await kakaoGet(url, key);
  const admin = (data.documents ?? []).find((doc) => doc.region_type === 'H') ?? null;
  const result = {
    admin_dong: admin?.region_3depth_h_name ?? admin?.region_3depth_name ?? '',
    region_1depth_name: admin?.region_1depth_name ?? '',
    region_2depth_name: admin?.region_2depth_name ?? '',
  };
  cache.set(cacheKey, result);
  return result;
}

async function fetchKakaoPlaceDetail(placeId) {
  const url = `https://place.map.kakao.com/main/v/${placeId}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://map.kakao.com/',
      },
    });
    const text = await response.text();
    await sleep(REQUEST_DELAY_MS);
    if (!response.ok) return { basicInfo: null, error: `HTTP ${response.status}` };
    return { basicInfo: JSON.parse(text)?.basicInfo ?? null, error: null };
  } catch (error) {
    return { basicInfo: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeTime(value) {
  if (!value) return '';
  const padded = String(value).padStart(4, '0');
  if (padded === '2400') return '24:00';
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

function expandDayExpression(dayOfWeek = '') {
  if (!dayOfWeek) return [];
  if (dayOfWeek.includes('매일')) return [0, 1, 2, 3, 4, 5, 6];
  const compact = dayOfWeek.replace(/\s/g, '');
  const rangeMatch = compact.match(/([월화수목금토일])~([월화수목금토일])/);
  if (rangeMatch) {
    const start = KR_DAY_TO_INDEX.get(rangeMatch[1]);
    const end = KR_DAY_TO_INDEX.get(rangeMatch[2]);
    if (start == null || end == null) return [];
    const days = [];
    let cursor = start;
    for (let guard = 0; guard < 7; guard += 1) {
      days.push(cursor);
      if (cursor === end) break;
      cursor = (cursor + 1) % 7;
    }
    return days;
  }
  return [...compact].flatMap((char) => KR_DAY_TO_INDEX.has(char) ? [KR_DAY_TO_INDEX.get(char)] : []);
}

function emptyWeeklyHours() {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
}

function parseWeeklyHours(openHour) {
  const weekly = emptyWeeklyHours();
  const businessPeriod = openHour?.periodList?.find((period) => period.timeName === '영업시간');
  const timeList = businessPeriod?.timeList ?? [];
  for (const entry of timeList) {
    const days = expandDayExpression(entry.dayOfWeek);
    for (const dayIndex of days) {
      weekly[DAY_KEYS[dayIndex]].push({
        open: normalizeTime(entry.startTime),
        close: normalizeTime(entry.endTime),
      });
    }
  }
  return weekly;
}

function parseRegularHoliday(openHour) {
  const offdayPeriod = openHour?.periodList?.find((period) => /휴무|휴일/.test(period.timeName ?? ''));
  const items = offdayPeriod?.timeList ?? openHour?.offdayList ?? [];
  return items.map((item) => item.dayOfWeek || item.offday || item.name || JSON.stringify(item)).filter(Boolean);
}

function chooseSurveyZone(lat, lng) {
  let best = SURVEY_ZONES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const zone of SURVEY_ZONES) {
    const dLat = lat - zone.center.lat;
    const dLng = (lng - zone.center.lng) * Math.cos((lat * Math.PI) / 180);
    const distance = dLat * dLat + dLng * dLng;
    if (distance < bestDistance) {
      best = zone;
      bestDistance = distance;
    }
  }
  return `${best.id}_${best.name}`;
}

function formatWeeklyForExcel(weekly) {
  const order = [
    ['월', 'mon'],
    ['화', 'tue'],
    ['수', 'wed'],
    ['목', 'thu'],
    ['금', 'fri'],
    ['토', 'sat'],
    ['일', 'sun'],
  ];
  return order.map(([label, key]) => {
    const hours = weekly[key] ?? [];
    return `${label}: ${hours.length ? hours.map((h) => `${h.open}-${h.close}`).join(', ') : '미확인'}`;
  }).join('\n');
}

function excelRowsFromPlaces(places) {
  return places.map((place) => [
    place.place_id,
    place.name,
    place.category,
    place.kakao_category_name,
    place.address,
    place.road_address,
    place.lat,
    place.lng,
    place.admin_dong,
    place.survey_zone,
    formatWeeklyForExcel(place.weekly_hours),
    place.regular_holiday.join(', '),
    place.business_status,
    place.confidence,
    place.last_verified_at,
    place.source_url,
    place.kakao_place_url,
    place.source_grid_id,
    place.notes,
  ]);
}

async function saveJson(fileName, data) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), JSON.stringify(data, null, 2), 'utf8');
}

async function buildWorkbook(places, stats) {
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add('Summary');
  const placesSheet = workbook.worksheets.add('Places');
  const gridsSheet = workbook.worksheets.add('Grid Searches');
  const schemaSheet = workbook.worksheets.add('Schema');
  workbook.comments.setSelf({ displayName: 'User' });

  const createdAt = new Date();
  const verified = places.filter((p) => p.confidence === 'verified').length;
  const estimated = places.filter((p) => p.confidence === 'estimated').length;
  const unverified = places.filter((p) => p.confidence === 'unverified').length;
  const cafeCount = places.filter((p) => p.category === 'cafe').length;
  const restaurantCount = places.filter((p) => p.category === 'restaurant').length;

  summary.getRange('A1:F1').merge();
  summary.getRange('A1').values = [['강릉시 교1동 카카오지도 카페/음식점 수집 결과']];
  summary.getRange('A3:B10').values = [
    ['수집 기준', '카카오 로컬 API category CE7/FD6 + 좌표 역조회 행정동 교1동 필터'],
    ['생성일', createdAt],
    ['총 장소 수', places.length],
    ['카페 수', cafeCount],
    ['음식점 수', restaurantCount],
    ['운영시간 검증됨', verified],
    ['운영시간 추정/부분확인', estimated],
    ['운영시간 미확인', unverified],
  ];
  summary.getRange('A12:B15').values = [
    ['주의사항', '카카오 로컬 API는 장소 목록/좌표를 제공하지만 운영시간은 공식 필드가 아닙니다. 장소 상세 JSON에서 확인되는 경우만 채웠습니다.'],
    ['안심길 사용 권장', 'confidence=verified 또는 estimated만 보조 안전 요소로 쓰고, unverified는 계산에서 제외하거나 낮은 가중치로 처리하세요.'],
    ['중복 제거', '카카오 place_id 기준'],
    ['행정동 필터', 'Kakao coord2regioncode의 region_3depth_h_name이 교1동인 장소만 포함'],
  ];

  const headers = [
    'place_id', 'name', 'category', 'kakao_category_name', 'address', 'road_address',
    'lat', 'lng', 'admin_dong', 'survey_zone', 'weekly_hours', 'regular_holiday',
    'business_status', 'confidence', 'last_verified_at', 'source_url', 'kakao_place_url',
    'source_grid_id', 'notes',
  ];
  const rows = excelRowsFromPlaces(places);
  placesSheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  if (rows.length) placesSheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;

  const gridHeaders = ['grid_id', 'category', 'depth', 'rect', 'pageable_count', 'total_count', 'subdivided'];
  const gridRows = stats.gridSearches.map((row) => [
    row.grid_id,
    row.category,
    row.depth,
    row.rect,
    row.pageable_count,
    row.total_count,
    row.subdivided ? 'yes' : 'no',
  ]);
  gridsSheet.getRangeByIndexes(0, 0, 1, gridHeaders.length).values = [gridHeaders];
  if (gridRows.length) gridsSheet.getRangeByIndexes(1, 0, gridRows.length, gridHeaders.length).values = gridRows;

  schemaSheet.getRange('A1:C12').values = [
    ['field', 'meaning', 'use_for_safe_route'],
    ['name', '가게명', '지도/목록 표시'],
    ['category', 'cafe 또는 restaurant', '안전 요소 종류별 가중치'],
    ['lat,lng', '좌표', '경로 주변 거리 계산'],
    ['admin_dong', '행정동', '교1동/교2동 필터'],
    ['survey_zone', '세부 조사구역', '구역별 진행률/검수'],
    ['weekly_hours', '요일별 운영시간', '특정 시각 영업 여부 판단'],
    ['regular_holiday', '정기휴무', '영업 여부 보정'],
    ['business_status', '영업중/폐업/이전/확인불가', '폐업/이전 제외'],
    ['confidence', 'verified/estimated/unverified', '가중치 또는 제외 기준'],
    ['last_verified_at', '마지막 확인일', '오래된 데이터 경고'],
    ['source_url', '출처', '검수/재확인 링크'],
  ];

  for (const sheet of [summary, placesSheet, gridsSheet, schemaSheet]) {
    sheet.showGridLines = false;
    const used = sheet.getUsedRange();
    used.format.font = { name: 'Calibri', size: 10 };
    used.format.wrapText = true;
    used.format.autofitColumns();
    used.format.autofitRows();
  }

  summary.getRange('A1:F1').format = {
    fill: '#17324D',
    font: { bold: true, color: '#FFFFFF', size: 15 },
  };
  summary.getRange('A3:A10').format = { fill: '#EAF2F8', font: { bold: true } };
  summary.getRange('A12:A15').format = { fill: '#FFF4CE', font: { bold: true } };
  summary.getRange('B4').format.numberFormat = 'yyyy-mm-dd hh:mm';

  placesSheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: '#245B45',
    font: { bold: true, color: '#FFFFFF' },
  };
  gridsSheet.getRangeByIndexes(0, 0, 1, gridHeaders.length).format = {
    fill: '#5B3A29',
    font: { bold: true, color: '#FFFFFF' },
  };
  schemaSheet.getRange('A1:C1').format = {
    fill: '#3E4C59',
    font: { bold: true, color: '#FFFFFF' },
  };

  placesSheet.freezePanes.freezeRows(1);
  gridsSheet.freezePanes.freezeRows(1);
  schemaSheet.freezePanes.freezeRows(1);

  placesSheet.tables.add(`A1:S${Math.max(2, rows.length + 1)}`, true, 'PlacesTable');
  gridsSheet.tables.add(`A1:G${Math.max(2, gridRows.length + 1)}`, true, 'GridSearchesTable');
  schemaSheet.tables.add('A1:C12', true, 'SchemaTable');

  const preview = await workbook.render({ sheetName: 'Summary', autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(path.join(outputDir, 'gyo1_places_summary_preview.png'), new Uint8Array(await preview.arrayBuffer()));

  const errors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 100 },
    summary: 'formula error scan',
  });
  await fs.writeFile(path.join(outputDir, 'workbook_formula_error_scan.ndjson'), errors.ndjson, 'utf8');

  const output = await SpreadsheetFile.exportXlsx(workbook);
  const workbookPath = path.join(outputDir, 'gangneung_gyo1_kakao_places.xlsx');
  await output.save(workbookPath);
  return workbookPath;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const key = await getKakaoRestKey();
  const startedAt = new Date();
  const stats = {
    started_at: startedAt.toISOString(),
    search_bounds: SEARCH_BOUNDS,
    gridSearches: [],
    raw_document_count: 0,
    unique_candidate_count: 0,
    admin_filtered_count: 0,
  };

  const rawDocs = [];
  const rects = buildInitialRects();
  for (const category of CATEGORY_CODES) {
    for (const rect of rects) {
      const docs = await searchCategoryInRect(category, rect, key, rect.id, 0, stats);
      rawDocs.push(...docs);
      process.stdout.write('.');
    }
    process.stdout.write(` ${category.label} done\n`);
  }
  stats.raw_document_count = rawDocs.length;

  const unique = new Map();
  for (const doc of rawDocs) {
    if (!unique.has(doc.id)) unique.set(doc.id, doc);
  }
  stats.unique_candidate_count = unique.size;

  const regionCache = new Map();
  const candidates = [...unique.values()];
  const regionChecked = await mapLimit(candidates, DETAIL_CONCURRENCY, async (doc, index) => {
    const lng = Number(doc.x);
    const lat = Number(doc.y);
    const region = await getAdminDong(lng, lat, key, regionCache);
    if ((index + 1) % 50 === 0) process.stdout.write(`r${index + 1}`);
    return { doc, lng, lat, region };
  });

  const gyo1Candidates = regionChecked.filter(({ region }) => region.region_2depth_name === '강릉시' && region.admin_dong === '교1동');
  const enriched = await mapLimit(gyo1Candidates, DETAIL_CONCURRENCY, async ({ doc, lng, lat, region }, index) => {

    const detail = await fetchKakaoPlaceDetail(doc.id);
    const openHour = detail.basicInfo?.openHour ?? null;
    const weekly = openHour ? parseWeeklyHours(openHour) : emptyWeeklyHours();
    const hasHours = Object.values(weekly).some((entries) => entries.length > 0);
    const regularHoliday = openHour ? parseRegularHoliday(openHour) : [];
    const category = doc._categoryLabel === 'cafe' ? 'cafe' : 'restaurant';
    const placeUrl = doc.place_url || `https://place.map.kakao.com/${doc.id}`;

    if ((index + 1) % 25 === 0) process.stdout.write(`d${index + 1}`);
    return {
      place_id: `kakao_${doc.id}`,
      kakao_id: doc.id,
      name: doc.place_name ?? '',
      category,
      kakao_category_name: doc.category_name ?? '',
      address: doc.address_name ?? '',
      road_address: doc.road_address_name ?? '',
      lat,
      lng,
      admin_dong: region.admin_dong,
      survey_zone: chooseSurveyZone(lat, lng),
      weekly_hours: weekly,
      regular_holiday: regularHoliday,
      business_status: 'active',
      confidence: hasHours ? 'estimated' : 'unverified',
      last_verified_at: startedAt.toISOString().slice(0, 10),
      source_url: placeUrl,
      kakao_place_url: placeUrl,
      source_grid_id: doc._gridId,
      notes: hasHours ? '카카오 장소 상세 JSON에서 운영시간 후보 확인' : '카카오 공식 로컬 API에는 운영시간 필드가 없어 운영시간 미확인',
    };
  });
  const places = enriched.filter(Boolean);
  process.stdout.write('\n');

  places.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ko'));
  stats.admin_filtered_count = places.length;
  stats.finished_at = new Date().toISOString();

  const safeRoutePlaces = places.map((place) => ({
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
  }));

  await saveJson('gangneung_gyo1_kakao_places_full.json', { metadata: stats, places });
  await saveJson('gangneung_gyo1_safe_route_places.json', { metadata: stats, places: safeRoutePlaces });
  await saveJson('gangneung_gyo1_grid_search_log.json', stats);
  const workbookPath = await buildWorkbook(places, stats);

  console.log(JSON.stringify({
    outputDir,
    workbookPath,
    fullJson: path.join(outputDir, 'gangneung_gyo1_kakao_places_full.json'),
    safeRouteJson: path.join(outputDir, 'gangneung_gyo1_safe_route_places.json'),
    places: places.length,
    cafe: places.filter((p) => p.category === 'cafe').length,
    restaurant: places.filter((p) => p.category === 'restaurant').length,
    estimatedHours: places.filter((p) => p.confidence === 'estimated').length,
    unverifiedHours: places.filter((p) => p.confidence === 'unverified').length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
