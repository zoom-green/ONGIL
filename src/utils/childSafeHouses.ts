import type { ChildSafeHousePoint } from '../types';

const CACHE_KEY = 'ongil_child_safe_houses_v1';
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY as string | undefined;
const API_BASE_URL = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  ''
).replace(/\/$/, '');
const STATIC_FALLBACK_URL = '/data/child-safe-houses-gangneung.json';

interface KakaoKeywordItem {
  id?: string;
  place_name?: string;
  road_address_name?: string;
  address_name?: string;
  phone?: string;
  x?: string;
  y?: string;
}

function isChildSafeHousePoint(item: unknown): item is ChildSafeHousePoint {
  if (!item || typeof item !== 'object') return false;
  const point = item as Partial<ChildSafeHousePoint>;
  return (
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng)) &&
    typeof point.name === 'string' &&
    typeof point.address === 'string' &&
    typeof point.categoryName === 'string'
  );
}

function readCachedChildSafeHouses(): ChildSafeHousePoint[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function writeCachedChildSafeHouses(items: ChildSafeHousePoint[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {
    // Storage can be unavailable in some mobile private browsing modes.
  }
}

function toKakaoChildSafeHouse(item: KakaoKeywordItem): ChildSafeHousePoint | null {
  const lat = Number(item.y);
  const lng = Number(item.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address = item.road_address_name || item.address_name || '';
  if (!address.includes('강릉시')) return null;
  return {
    id: String(item.id ?? `${lat},${lng}`),
    name: item.place_name ?? '아동안전지킴이집',
    lat,
    lng,
    address,
    categoryName: '아동안전지킴이집',
    phone: item.phone || undefined,
    source: 'Kakao',
  };
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').replace(/[-,._()]/g, '').toLowerCase();
}

function mergeChildSafeHouses(items: ChildSafeHousePoint[]): ChildSafeHousePoint[] {
  return items.reduce<ChildSafeHousePoint[]>((merged, item) => {
    const same = merged.some((existing) => {
      const sameAddress = normalize(existing.address) && normalize(existing.address) === normalize(item.address);
      const sameName = normalize(existing.name) && normalize(existing.name) === normalize(item.name);
      const veryClose = Math.abs(existing.lat - item.lat) < 0.0002 && Math.abs(existing.lng - item.lng) < 0.0002;
      return sameAddress || sameName || veryClose;
    });
    if (!same) merged.push(item);
    return merged;
  }, []);
}

async function fetchKakaoFallback(): Promise<ChildSafeHousePoint[]> {
  if (!KAKAO_REST_KEY) return [];
  const queries = ['강릉 아동안전지킴이집', '강릉시 안전지킴이집'];
  const results = await Promise.allSettled(queries.map(async (query) => {
    const params = new URLSearchParams({
      query,
      rect: '128.70,37.55,129.10,37.95',
      size: '15',
      page: '1',
    });
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const documents: KakaoKeywordItem[] = data.documents ?? [];
    return documents.map(toKakaoChildSafeHouse).filter((item): item is ChildSafeHousePoint => Boolean(item));
  }));
  return mergeChildSafeHouses(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
}

async function fetchStaticFallback(): Promise<ChildSafeHousePoint[]> {
  try {
    const res = await fetch(STATIC_FALLBACK_URL, { cache: 'force-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    return mergeChildSafeHouses(items.filter(isChildSafeHousePoint));
  } catch {
    return [];
  }
}

export async function fetchChildSafeHouses(): Promise<ChildSafeHousePoint[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/child-safe-houses`);
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length > 0) {
        writeCachedChildSafeHouses(items);
        return items;
      }
    }
  } catch {
    // Native mobile builds do not have a local /api server; fall back below.
  }

  const staticItems = await fetchStaticFallback();
  if (staticItems.length > 0) {
    writeCachedChildSafeHouses(staticItems);
    return staticItems;
  }

  const fallbackItems = await fetchKakaoFallback();
  if (fallbackItems.length > 0) {
    writeCachedChildSafeHouses(fallbackItems);
    return fallbackItems;
  }

  const cached = readCachedChildSafeHouses();
  if (cached.length > 0) return cached;
  throw new Error('Failed to load child safe houses');
}
