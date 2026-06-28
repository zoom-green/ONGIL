import type { LatLng, MapBounds, SafeSpot, SafetyFeatureId } from '../types';

const REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY as string;

const KO = {
  everyDay: '\uB9E4\uC77C',
  businessHours: '\uC601\uC5C5\uC2DC\uAC04',
  police: '\uACBD\uCC30',
  districtUnit: '\uC9C0\uAD6C\uB300',
  policeBox: '\uD30C\uCD9C\uC18C',
  publicSafety: '\uCE58\uC548',
  fire: '\uC18C\uBC29',
  policeLabel: '\uACBD\uCC30\uC11C/\uC9C0\uAD6C\uB300',
  fireLabel: '\uC18C\uBC29\uC11C',
};

const TIMED_CATEGORIES: { code: string; featureId: SafetyFeatureId; weight: number; nightWeight: number }[] = [
  { code: 'CS2', featureId: 'convenience', weight: 3, nightWeight: 5 },
  { code: 'CE7', featureId: 'food', weight: 2, nightWeight: 1 },
  { code: 'FD6', featureId: 'food', weight: 1, nightWeight: 0.5 },
  { code: 'HP8', featureId: 'medical', weight: 4, nightWeight: 6 },
];

const KAKAO_FEATURE_CATEGORIES: Partial<Record<SafetyFeatureId, { code: string; weight: number; nightWeight: number }[]>> = {
  convenience: [{ code: 'CS2', weight: 3, nightWeight: 5 }],
  food: [
    { code: 'CE7', weight: 2, nightWeight: 1 },
    { code: 'FD6', weight: 1, nightWeight: 0.5 },
  ],
  medical: [{ code: 'HP8', weight: 4, nightWeight: 6 }],
  police: [{ code: 'PO3', weight: 5, nightWeight: 8 }],
  fire: [{ code: 'PO3', weight: 4, nightWeight: 6 }],
};

const GANGNEUNG_BOUNDS = {
  south: 37.45,
  west: 128.65,
  north: 37.95,
  east: 129.12,
};

const KR_DAYS = ['\uC77C', '\uC6D4', '\uD654', '\uC218', '\uBAA9', '\uAE08', '\uD1A0'];

interface TimeEntry {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
}
interface Period {
  timeName: string;
  timeList: TimeEntry[];
}
interface OpenHour {
  periodList: Period[];
}

function isInsideGangneung(point: LatLng): boolean {
  return point.lat >= GANGNEUNG_BOUNDS.south && point.lat <= GANGNEUNG_BOUNDS.north
    && point.lng >= GANGNEUNG_BOUNDS.west && point.lng <= GANGNEUNG_BOUNDS.east;
}

function isBoundsInsideGangneung(bounds: MapBounds): boolean {
  return isInsideGangneung(bounds.center)
    || isInsideGangneung(bounds.sw)
    || isInsideGangneung(bounds.ne);
}

function rectFromBounds(bounds: MapBounds): string {
  const west = Math.max(bounds.sw.lng, GANGNEUNG_BOUNDS.west);
  const south = Math.max(bounds.sw.lat, GANGNEUNG_BOUNDS.south);
  const east = Math.min(bounds.ne.lng, GANGNEUNG_BOUNDS.east);
  const north = Math.min(bounds.ne.lat, GANGNEUNG_BOUNDS.north);
  return `${west},${south},${east},${north}`;
}

function classifyPublicSpot(text: string): SafetyFeatureId | null {
  if (text.includes(KO.police) || text.includes(KO.districtUnit) || text.includes(KO.policeBox) || text.includes(KO.publicSafety)) return 'police';
  if (text.includes(KO.fire) || text.includes('119')) return 'fire';
  return null;
}

function matchesDay(dayOfWeek: string, todayIdx: number): boolean {
  if (dayOfWeek.includes(KO.everyDay)) return true;
  const todayKr = KR_DAYS[todayIdx];
  const rangeMatch = dayOfWeek.match(/([\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0])~([\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0])/);
  if (rangeMatch) {
    const start = KR_DAYS.indexOf(rangeMatch[1]);
    const end = KR_DAYS.indexOf(rangeMatch[2]);
    if (start !== -1 && end !== -1) {
      return start <= end ? todayIdx >= start && todayIdx <= end : todayIdx >= start || todayIdx <= end;
    }
  }
  return dayOfWeek.split(',').map((day) => day.trim()).includes(todayKr);
}

function isOpenNow(openHour: OpenHour | null | undefined): boolean | null {
  if (!openHour?.periodList?.length) return null;
  const business = openHour.periodList.find((period) => period.timeName === KO.businessHours);
  if (!business?.timeList?.length) return null;

  const now = new Date();
  const todayIdx = now.getDay();
  const current = now.getHours() * 100 + now.getMinutes();

  for (const entry of business.timeList) {
    if (!matchesDay(entry.dayOfWeek, todayIdx)) continue;
    if (entry.startTime === '0000' && (entry.endTime === '0000' || entry.endTime === '2400')) return true;
    const start = Number.parseInt(entry.startTime, 10);
    const end = Number.parseInt(entry.endTime, 10);
    if (end < start) return current >= start || current < end;
    return current >= start && current < end;
  }
  return null;
}

async function fetchOpenStatus(placeId: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`/api/hours?placeId=${placeId}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return isOpenNow(data?.openHour ?? null);
  } catch {
    return null;
  }
}

async function searchTimedCategory(
  code: string,
  featureId: SafetyFeatureId,
  weight: number,
  nightWeight: number,
  center: LatLng,
  radius: number,
): Promise<SafeSpot[]> {
  const params = new URLSearchParams({
    category_group_code: code,
    x: String(center.lng),
    y: String(center.lat),
    radius: String(radius),
    size: '15',
  });
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
    headers: { Authorization: `KakaoAK ${REST_KEY}` },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const raw: { id: string; place_name: string; x: string; y: string; category_name: string }[] = data.documents ?? [];
  const statuses = await Promise.allSettled(raw.map((place) => fetchOpenStatus(place.id)));

  return raw
    .filter((place) => isInsideGangneung({ lat: Number.parseFloat(place.y), lng: Number.parseFloat(place.x) }))
    .filter((_, index) => {
      const result = statuses[index];
      const open = result.status === 'fulfilled' ? result.value : null;
      return open !== false;
    })
    .map((place) => ({
      name: place.place_name,
      lat: Number.parseFloat(place.y),
      lng: Number.parseFloat(place.x),
      category: place.category_name,
      featureId,
      weight,
      nightWeight,
    }));
}

async function fetchEmergencySpots(center: LatLng, radius: number): Promise<SafeSpot[]> {
  const params = new URLSearchParams({
    category_group_code: 'PO3',
    x: String(center.lng),
    y: String(center.lat),
    radius: String(radius),
    size: '15',
  });
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
    headers: { Authorization: `KakaoAK ${REST_KEY}` },
  });
  if (!res.ok) return [];

  const data = await res.json();
  return (data.documents ?? []).flatMap((place: { place_name?: string; x?: string; y?: string; category_name?: string }) => {
    const lat = Number.parseFloat(place.y ?? '');
    const lng = Number.parseFloat(place.x ?? '');
    if (!isInsideGangneung({ lat, lng })) return [];
    const featureId = classifyPublicSpot(`${place.category_name ?? ''} ${place.place_name ?? ''}`);
    if (!featureId) return [];
    const config = KAKAO_FEATURE_CATEGORIES[featureId]?.[0];
    return [{
      name: place.place_name ?? (featureId === 'police' ? KO.policeLabel : KO.fireLabel),
      lat,
      lng,
      category: place.category_name ?? '',
      featureId,
      weight: config?.weight ?? (featureId === 'police' ? 5 : 4),
      nightWeight: config?.nightWeight ?? (featureId === 'police' ? 8 : 6),
    }];
  });
}

async function searchCategoryInBounds(
  code: string,
  requestedFeatureId: SafetyFeatureId,
  weight: number,
  nightWeight: number,
  bounds: MapBounds,
): Promise<SafeSpot[]> {
  const results: SafeSpot[] = [];
  for (let page = 1; page <= 1; page += 1) {
    const params = new URLSearchParams({
      category_group_code: code,
      rect: rectFromBounds(bounds),
      page: String(page),
      size: '15',
    });
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
      headers: { Authorization: `KakaoAK ${REST_KEY}` },
    });
    if (!res.ok) break;

    const data = await res.json();
    const documents: Array<{ place_name?: string; x?: string; y?: string; category_name?: string }> = data.documents ?? [];
    for (const place of documents) {
      const lat = Number.parseFloat(place.y ?? '');
      const lng = Number.parseFloat(place.x ?? '');
      if (!isInsideGangneung({ lat, lng })) continue;

      let featureId: SafetyFeatureId | null = requestedFeatureId;
      if (code === 'PO3') {
        featureId = classifyPublicSpot(`${place.category_name ?? ''} ${place.place_name ?? ''}`);
        if (featureId !== requestedFeatureId) continue;
      }

      results.push({
        name: place.place_name ?? '',
        lat,
        lng,
        category: place.category_name ?? '',
        featureId,
        weight,
        nightWeight,
      });
    }
    if (data.meta?.is_end) break;
  }
  return results;
}

export async function fetchSafeSpotsInBounds(bounds: MapBounds, featureIds: SafetyFeatureId[]): Promise<SafeSpot[]> {
  if (!isBoundsInsideGangneung(bounds)) return [];
  const searchable = featureIds.flatMap((featureId) =>
    (KAKAO_FEATURE_CATEGORIES[featureId] ?? []).map((category) => ({ featureId, ...category })),
  );
  const results = await Promise.all(
    searchable.map((category) =>
      searchCategoryInBounds(category.code, category.featureId, category.weight, category.nightWeight, bounds),
    ),
  );
  return results.flat();
}

export async function fetchSafeSpots(center: LatLng, radiusMeters = 1500): Promise<SafeSpot[]> {
  if (!isInsideGangneung(center)) return [];
  const [timedResults, emergency] = await Promise.all([
    Promise.all(
      TIMED_CATEGORIES.map((category) =>
        searchTimedCategory(category.code, category.featureId, category.weight, category.nightWeight, center, radiusMeters),
      ),
    ),
    fetchEmergencySpots(center, radiusMeters),
  ]);
  return [...timedResults.flat(), ...emergency];
}
