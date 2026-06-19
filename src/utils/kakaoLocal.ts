import type { LatLng, SafeSpot } from '../types';

const REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY as string;

// 영업시간 체크 대상 카테고리 (주간/야간 가중치 분리)
const TIMED_CATEGORIES: { code: string; weight: number; nightWeight: number }[] = [
  { code: 'CS2', weight: 3, nightWeight: 5 }, // 편의점: 야간에 더 중요 (24시간 운영)
  { code: 'CE7', weight: 2, nightWeight: 1 }, // 카페: 야간 영업 드물어 낮춤
  { code: 'FD6', weight: 1, nightWeight: 0.5 }, // 음식점: 야간 영업 드물어 낮춤
];

// Kakao 요일 인덱스: 0=일 1=월 2=화 3=수 4=목 5=금 6=토
const KR_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

interface TimeEntry {
  dayOfWeek: string;
  startTime: string; // "HHMM"
  endTime: string;   // "HHMM"
}
interface Period {
  timeName: string;
  timeList: TimeEntry[];
}
interface OpenHour {
  periodList: Period[];
}

function matchesDay(dayOfWeek: string, todayIdx: number): boolean {
  if (dayOfWeek.includes('매일')) return true;
  const todayKr = KR_DAYS[todayIdx];
  const rangeMatch = dayOfWeek.match(/([월화수목금토일])~([월화수목금토일])/);
  if (rangeMatch) {
    const s = KR_DAYS.indexOf(rangeMatch[1]);
    const e = KR_DAYS.indexOf(rangeMatch[2]);
    if (s !== -1 && e !== -1) {
      return s <= e ? todayIdx >= s && todayIdx <= e : todayIdx >= s || todayIdx <= e;
    }
  }
  return dayOfWeek.split(',').map((d) => d.trim()).includes(todayKr);
}

// true=영업 중 / false=영업 종료 / null=데이터 없음(포함 처리)
function isOpenNow(openHour: OpenHour | null | undefined): boolean | null {
  if (!openHour?.periodList?.length) return null;
  const business = openHour.periodList.find((p) => p.timeName === '영업시간');
  if (!business?.timeList?.length) return null;

  const now = new Date();
  const todayIdx = now.getDay();
  const current = now.getHours() * 100 + now.getMinutes();

  for (const entry of business.timeList) {
    if (!matchesDay(entry.dayOfWeek, todayIdx)) continue;
    if (entry.startTime === '0000' && (entry.endTime === '0000' || entry.endTime === '2400')) return true;
    const start = parseInt(entry.startTime);
    const end = parseInt(entry.endTime);
    if (end < start) return current >= start || current < end; // 자정 넘김
    return current >= start && current < end;
  }
  return null;
}

async function fetchOpenStatus(placeId: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    // 백엔드 프록시를 통해 호출 (CORS 우회)
    const res = await fetch(`/api/hours?placeId=${placeId}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    return isOpenNow(data?.openHour ?? null);
  } catch {
    return null;
  }
}

// 영업시간 체크 카테고리 (편의점·카페·음식점)
async function searchTimedCategory(
  code: string,
  weight: number,
  nightWeight: number,
  center: LatLng,
  radius: number
): Promise<SafeSpot[]> {
  const params = new URLSearchParams({
    category_group_code: code,
    x: String(center.lng),
    y: String(center.lat),
    radius: String(radius),
    size: '15',
  });
  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/category.json?${params}`,
    { headers: { Authorization: `KakaoAK ${REST_KEY}` } }
  );
  if (!res.ok) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const raw: { id: string; place_name: string; x: string; y: string; category_name: string }[] =
    data.documents ?? [];

  const statuses = await Promise.allSettled(raw.map((d) => fetchOpenStatus(d.id)));

  return raw
    .filter((_, i) => {
      const r = statuses[i];
      const open = r.status === 'fulfilled' ? r.value : null;
      return open !== false; // 확실히 닫힌 곳만 제외
    })
    .map((d) => ({
      name: d.place_name,
      lat: parseFloat(d.y),
      lng: parseFloat(d.x),
      category: d.category_name,
      weight,
      nightWeight,
    }));
}

// 지구대·경찰서·소방서 — 항상 운영, 영업시간 체크 없음
async function fetchEmergencySpots(center: LatLng, radius: number): Promise<SafeSpot[]> {
  const params = new URLSearchParams({
    category_group_code: 'PO3',
    x: String(center.lng),
    y: String(center.lat),
    radius: String(radius),
    size: '15',
  });
  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/category.json?${params}`,
    { headers: { Authorization: `KakaoAK ${REST_KEY}` } }
  );
  if (!res.ok) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.documents ?? []).flatMap((d: any) => {
    const cat: string = d.category_name ?? '';
    const isPolice = cat.includes('경찰') || cat.includes('지구대') || cat.includes('파출소');
    const isFire = cat.includes('소방');
    if (!isPolice && !isFire) return [];
    return [{
      name: d.place_name as string,
      lat: parseFloat(d.y),
      lng: parseFloat(d.x),
      category: cat,
      weight: isPolice ? 5 : 4,
      nightWeight: isPolice ? 8 : 6,
    }];
  });
}

export async function fetchSafeSpots(
  center: LatLng,
  radiusMeters = 1500
): Promise<SafeSpot[]> {
  const [timedResults, emergency] = await Promise.all([
    Promise.all(
      TIMED_CATEGORIES.map((c) => searchTimedCategory(c.code, c.weight, c.nightWeight, center, radiusMeters))
    ),
    fetchEmergencySpots(center, radiusMeters),
  ]);
  return [...timedResults.flat(), ...emergency];
}
