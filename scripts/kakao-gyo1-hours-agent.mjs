import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'outputs', 'kakao_gyo1_places');
const inputPath = path.join(outputDir, 'gangneung_gyo1_kakao_places_full.json');

const REQUEST_DELAY_MS = 80;
const CONCURRENCY = 8;
const DAY_MAP = new Map([
  ['월', 'mon'],
  ['화', 'tue'],
  ['수', 'wed'],
  ['목', 'thu'],
  ['금', 'fri'],
  ['토', 'sat'],
  ['일', 'sun'],
]);

function kstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function emptyWeeklyHours() {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

function parseTimeRange(desc) {
  if (!desc || /휴무|쉬는/.test(desc)) return [];
  if (/24시간|00:00\s*~\s*24:00|00:00\s*~\s*00:00/.test(desc)) {
    return [{ open: '00:00', close: '24:00' }];
  }
  const ranges = [];
  const regex = /(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2}|24:00)/g;
  let match;
  while ((match = regex.exec(desc))) {
    ranges.push({ open: match[1].padStart(5, '0'), close: match[2].padStart(5, '0') });
  }
  return ranges;
}

function parseDayKey(dayDesc = '') {
  const match = dayDesc.match(/[월화수목금토일]/);
  return match ? DAY_MAP.get(match[0]) : null;
}

function parseOpenHours(openHours) {
  const weekly = emptyWeeklyHours();
  const regularHoliday = [];
  const rawDays = [];
  const weekPeriods = openHours?.week_from_today?.week_periods ?? [];

  for (const period of weekPeriods) {
    for (const day of period.days ?? []) {
      const dayKey = parseDayKey(day.day_of_the_week_desc);
      if (!dayKey) continue;

      const onDays = day.on_days ?? {};
      const offDays = day.off_days ?? {};
      const rangeDesc = onDays.start_end_time_desc || onDays.time_desc || '';
      const offDesc = offDays.desc || offDays.display_text || '';
      const ranges = parseTimeRange(rangeDesc);

      if (ranges.length) weekly[dayKey].push(...ranges);
      if (offDesc || /휴무/.test(rangeDesc)) regularHoliday.push(day.day_of_the_week_desc);

      rawDays.push({
        day: day.day_of_the_week_desc ?? '',
        time: rangeDesc || offDesc || '',
        highlighted: Boolean(day.is_highlight),
      });
    }
  }

  const daysOffDesc = openHours?.headline_addition?.days_off_desc || openHours?.week_from_today?.days_off_desc || '';
  if (daysOffDesc && !regularHoliday.includes(daysOffDesc)) regularHoliday.push(daysOffDesc);

  return {
    weekly,
    regularHoliday: [...new Set(regularHoliday)].filter(Boolean),
    rawDays,
    headline: openHours?.headline ?? null,
    headlineAddition: openHours?.headline_addition ?? null,
  };
}

async function fetchPanel(place) {
  const id = place.kakao_id || String(place.place_id).replace(/^kakao_/, '');
  const url = `https://place-api.map.kakao.com/places/panel3/${id}`;
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json, text/plain, */*',
          Referer: `https://place.map.kakao.com/${id}`,
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
      return { ok: true, error: null, panel: JSON.parse(text) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(REQUEST_DELAY_MS * attempt * 3);
    }
  }
  return { ok: false, error: lastError || 'unknown error', panel: null };
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
    const entries = weekly[key] ?? [];
    return `${label}: ${entries.length ? entries.map((entry) => `${entry.open}-${entry.close}`).join(', ') : '미확인/휴무'}`;
  }).join('\n');
}

function statusFromSummary(summary) {
  if (!summary) return '확인불가';
  if (summary.status === 'Y') return '영업중';
  if (summary.status === 'N') return '폐업/비활성 의심';
  return '확인불가';
}

function updatePlace(place, result, today) {
  if (!result.ok || !result.panel) {
    return {
      ...place,
      confidence: 'unverified',
      last_verified_at: today,
      notes: `카카오 panel3 요청 실패: ${result.error}`,
    };
  }

  const { panel } = result;
  const parsed = parseOpenHours(panel.open_hours);
  const hasHours = Object.values(parsed.weekly).some((entries) => entries.length > 0);
  const summary = panel.summary ?? {};

  return {
    ...place,
    name: summary.name || place.name,
    address: summary.address?.jibun ? `강원특별자치도 강릉시 ${summary.address.jibun}` : place.address,
    road_address: summary.address?.road || place.road_address,
    lat: summary.point?.lat ?? place.lat,
    lng: summary.point?.lon ?? place.lng,
    weekly_hours: parsed.weekly,
    regular_holiday: parsed.regularHoliday,
    business_status: statusFromSummary(summary),
    confidence: hasHours ? 'estimated' : 'unverified',
    last_verified_at: today,
    source_url: `https://place.map.kakao.com/${place.kakao_id}`,
    kakao_place_url: `https://place.map.kakao.com/${place.kakao_id}`,
    open_hours_headline: parsed.headline,
    open_hours_headline_addition: parsed.headlineAddition,
    open_hours_raw_days: parsed.rawDays,
    notes: hasHours ? '카카오맵 장소 panel3 API에서 운영시간 자동 수집' : '카카오맵 장소 panel3 API에 운영시간 없음',
  };
}

function toSafeRoutePlace(place) {
  return {
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
  };
}

function placeRows(places) {
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
    (place.regular_holiday ?? []).join(', '),
    place.business_status,
    place.confidence,
    place.last_verified_at,
    place.source_url,
    place.source_grid_id,
    place.notes,
  ]);
}

async function buildWorkbook(places, metadata) {
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add('Summary');
  const sheet = workbook.worksheets.add('Places');
  const raw = workbook.worksheets.add('Raw Hours');
  const schema = workbook.worksheets.add('Schema');

  const cafeCount = places.filter((p) => p.category === 'cafe').length;
  const restaurantCount = places.filter((p) => p.category === 'restaurant').length;
  const estimatedCount = places.filter((p) => p.confidence === 'estimated').length;
  const unverifiedCount = places.filter((p) => p.confidence === 'unverified').length;

  summary.getRange('A1:F1').merge();
  summary.getRange('A1').values = [['Gangneung Gyo1-dong Kakao Places With Business Hours']];
  summary.getRange('A3:B11').values = [
    ['Source', 'Kakao Local API place list + Kakao place panel3 business-hour data'],
    ['Generated at', kstDateString(new Date(metadata.finished_at))],
    ['Total places', places.length],
    ['Cafe', cafeCount],
    ['Restaurant', restaurantCount],
    ['Hours collected', estimatedCount],
    ['Hours unavailable', unverifiedCount],
    ['Admin dong', '교1동'],
    ['Note', 'Business hours are auto-collected from Kakao page data and should be human-reviewed for safety-critical use.'],
  ];

  const headers = [
    'place_id', 'name', 'category', 'kakao_category_name', 'address', 'road_address',
    'lat', 'lng', 'admin_dong', 'survey_zone', 'weekly_hours', 'regular_holiday',
    'business_status', 'confidence', 'last_verified_at', 'source_url', 'source_grid_id', 'notes',
  ];
  const rows = placeRows(places);
  sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  if (rows.length) sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;

  const rawHeaders = ['place_id', 'name', 'headline_code', 'headline_text', 'headline_info', 'raw_days'];
  const rawRows = places.map((place) => [
    place.place_id,
    place.name,
    place.open_hours_headline?.code ?? '',
    place.open_hours_headline?.display_text ?? '',
    place.open_hours_headline?.display_text_info ?? '',
    JSON.stringify(place.open_hours_raw_days ?? [], null, 0),
  ]);
  raw.getRangeByIndexes(0, 0, 1, rawHeaders.length).values = [rawHeaders];
  if (rawRows.length) raw.getRangeByIndexes(1, 0, rawRows.length, rawHeaders.length).values = rawRows;

  schema.getRange('A1:C12').values = [
    ['field', 'meaning', 'safe-route use'],
    ['name', '가게명', '지도/목록 표시'],
    ['category', 'cafe 또는 restaurant', '안전 요소 종류별 가중치'],
    ['lat,lng', '좌표', '경로 주변 거리 계산'],
    ['admin_dong', '행정동', '교1동 필터'],
    ['survey_zone', '세부 조사구역', '구역별 검수'],
    ['weekly_hours', '요일별 운영시간', '특정 시각 영업 여부 판단'],
    ['regular_holiday', '정기휴무/휴무 설명', '영업 여부 보정'],
    ['business_status', '영업중/폐업/확인불가', '폐업 의심 제외'],
    ['confidence', 'estimated/unverified', '자동 수집 신뢰도'],
    ['last_verified_at', '마지막 확인일', '오래된 데이터 경고'],
    ['source_url', '카카오 장소 URL', '검수/재확인 링크'],
  ];

  for (const ws of [summary, sheet, raw, schema]) {
    ws.showGridLines = false;
    const used = ws.getUsedRange();
    used.format.font = { name: 'Calibri', size: 10 };
    used.format.wrapText = true;
    used.format.autofitColumns();
    used.format.autofitRows();
  }

  summary.getRange('A1:F1').format = { fill: '#17324D', font: { bold: true, color: '#FFFFFF', size: 15 } };
  summary.getRange('A3:A11').format = { fill: '#EAF2F8', font: { bold: true } };
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = { fill: '#245B45', font: { bold: true, color: '#FFFFFF' } };
  raw.getRangeByIndexes(0, 0, 1, rawHeaders.length).format = { fill: '#5B3A29', font: { bold: true, color: '#FFFFFF' } };
  schema.getRange('A1:C1').format = { fill: '#3E4C59', font: { bold: true, color: '#FFFFFF' } };
  sheet.freezePanes.freezeRows(1);
  raw.freezePanes.freezeRows(1);
  schema.freezePanes.freezeRows(1);
  sheet.tables.add(`A1:R${Math.max(2, rows.length + 1)}`, true, 'PlacesTable');
  raw.tables.add(`A1:F${Math.max(2, rawRows.length + 1)}`, true, 'RawHoursTable');
  schema.tables.add('A1:C12', true, 'SchemaTable');

  const preview = await workbook.render({ sheetName: 'Summary', autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(path.join(outputDir, 'gyo1_places_hours_summary_preview.png'), new Uint8Array(await preview.arrayBuffer()));

  const output = await SpreadsheetFile.exportXlsx(workbook);
  const workbookPath = path.join(outputDir, 'gangneung_gyo1_kakao_places_with_hours.xlsx');
  await output.save(workbookPath);
  return workbookPath;
}

async function main() {
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const startedAt = new Date();
  const today = kstDateString(startedAt);

  const results = await mapLimit(input.places, CONCURRENCY, async (place, index) => {
    const panel = await fetchPanel(place);
    if ((index + 1) % 25 === 0) process.stdout.write(`${index + 1} `);
    return updatePlace(place, panel, today);
  });
  process.stdout.write('\n');

  const places = results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ko'));
  const metadata = {
    ...input.metadata,
    hours_started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    hours_source: 'https://place-api.map.kakao.com/places/panel3/{kakao_place_id}',
    hours_collected_count: places.filter((p) => p.confidence === 'estimated').length,
    hours_unavailable_count: places.filter((p) => p.confidence === 'unverified').length,
  };

  const fullPath = path.join(outputDir, 'gangneung_gyo1_kakao_places_with_hours_full.json');
  const safePath = path.join(outputDir, 'gangneung_gyo1_safe_route_places_with_hours.json');
  await fs.writeFile(fullPath, JSON.stringify({ metadata, places }, null, 2), 'utf8');
  await fs.writeFile(safePath, JSON.stringify({ metadata, places: places.map(toSafeRoutePlace) }, null, 2), 'utf8');
  const workbookPath = await buildWorkbook(places, metadata);

  console.log(JSON.stringify({
    places: places.length,
    hoursCollected: metadata.hours_collected_count,
    hoursUnavailable: metadata.hours_unavailable_count,
    workbookPath,
    fullPath,
    safePath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
