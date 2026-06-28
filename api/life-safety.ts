import https from 'https';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SAFEMAP_KEY = process.env.SAFEMAP_SERVICE_KEY ?? 'G6JN4CFY-G6JN-G6JN-G6JN-G6JN4CFY8E';
const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY ?? process.env.VITE_KAKAO_REST_KEY;

type FeatureId = 'police' | 'fire' | 'toilet';

interface SafetyPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  featureId: FeatureId;
  category: string;
  address?: string;
  source?: string;
  weight?: number;
  nightWeight?: number;
}

interface ApiDef {
  code: string;
  featureId: FeatureId;
  category: string;
  nameFields: string[];
  addressFields: string[];
  latFields?: string[];
  lngFields?: string[];
  needsEmergencyBell?: boolean;
  weight: number;
  nightWeight: number;
}

const API_DEFS: ApiDef[] = [
  {
    code: 'IF_0038',
    featureId: 'fire',
    category: '????',
    nameFields: ['fclty_nm'],
    addressFields: ['rn_adres', 'adres'],
    weight: 4,
    nightWeight: 6,
  },
  {
    code: 'IF_0036',
    featureId: 'police',
    category: '???/???',
    nameFields: ['fclty_nm'],
    addressFields: ['rn_adres', 'adres'],
    weight: 5,
    nightWeight: 8,
  },
  {
    code: 'IF_0132',
    featureId: 'toilet',
    category: '??? ?????',
    nameFields: ['fclty_nm', 'mng_inst_nm'],
    addressFields: ['lctn_rona_addr', 'lctn_lotno_addr'],
    needsEmergencyBell: true,
    weight: 2,
    nightWeight: 3,
  },
];

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        agent: new https.Agent({ rejectUnauthorized: false }),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
      (upstream) => {
        let body = '';
        upstream.on('data', (chunk) => { body += chunk; });
        upstream.on('end', () => {
          if ((upstream.statusCode ?? 500) >= 400) {
            reject(new Error(`Request failed ${upstream.statusCode}: ${url}`));
            return;
          }
          resolve(body);
        });
      }
    ).on('error', reject);
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}

function valueOf(item: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = item[field];
    if (value != null && String(value).trim() && String(value).trim() !== '-') return String(value).trim();
  }
  return '';
}

function isGangneung(item: Record<string, unknown>, def: ApiDef): boolean {
  const cityCode = String(item.sgg_cd ?? '');
  if (cityCode === '42150' || cityCode === '51150') return true;
  const text = [
    valueOf(item, def.addressFields),
    item.rn_adres,
    item.adres,
    item.lctn_rona_addr,
    item.lctn_lotno_addr,
  ].filter(Boolean).join(' ');
  return text.includes('강릉시') || text.includes('강원도 강릉') || text.includes('강원특별자치도 강릉');
}

function webMercatorToWgs84(x: number, y: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return null;
  const radius = 6378137;
  const lng = (x / radius) * 180 / Math.PI;
  const lat = (Math.atan(Math.sinh(y / radius))) * 180 / Math.PI;
  if (lat < 30 || lat > 45 || lng < 120 || lng > 135) return null;
  return { lat, lng };
}

function coordinatesFromItem(item: Record<string, unknown>, def: ApiDef): { lat: number; lng: number } | null {
  if (def.latFields?.length && def.lngFields?.length) {
    const lat = Number(valueOf(item, def.latFields));
    const lng = Number(valueOf(item, def.lngFields));
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) return { lat, lng };
  }
  return webMercatorToWgs84(Number(item.x), Number(item.y));
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!KAKAO_REST_KEY || !address) return null;
  try {
    const params = new URLSearchParams({ query: address });
    const data = await fetchJson<{ documents?: Array<{ x?: string; y?: string }> }>(
      `https://dapi.kakao.com/v2/local/search/address.json?${params}`,
    );
    const first = data.documents?.[0];
    const lat = Number(first?.y);
    const lng = Number(first?.x);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch {}
  return null;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').replace(/[-,._()]/g, '').toLowerCase();
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isSamePoint(a: SafetyPoint, b: SafetyPoint): boolean {
  if (a.featureId !== b.featureId) return false;
  if (normalize(a.address ?? '') && normalize(a.address ?? '') === normalize(b.address ?? '')) return true;
  if (normalize(a.name) && normalize(a.name) === normalize(b.name)) return true;
  return distanceMeters(a, b) <= 20;
}

function mergePoints(points: SafetyPoint[]): SafetyPoint[] {
  return points.reduce<SafetyPoint[]>((merged, point) => {
    if (!merged.some((existing) => isSamePoint(existing, point))) merged.push(point);
    return merged;
  }, []);
}

async function fetchApiItems(def: ApiDef): Promise<SafetyPoint[]> {
  const pageSize = 1000;
  let pageNo = 1;
  let totalCount = Infinity;
  const points: SafetyPoint[] = [];

  while ((pageNo - 1) * pageSize < totalCount && pageNo <= 20) {
    const params = new URLSearchParams({
      serviceKey: SAFEMAP_KEY,
      pageNo: String(pageNo),
      numOfRows: String(pageSize),
      type: 'json',
    });
    const data = await fetchJson<{
      header?: { resultCode?: string; resultMsg?: string };
      body?: { totalCount?: number; items?: { item?: Record<string, unknown>[] | Record<string, unknown> } };
    }>(`https://safemap.go.kr/openapi2/${def.code}?${params}`);

    if (data.header?.resultCode && data.header.resultCode !== '00') {
      throw new Error(`${def.code}: ${data.header.resultMsg ?? data.header.resultCode}`);
    }

    totalCount = Number(data.body?.totalCount ?? 0);
    const raw = data.body?.items?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    for (const item of items) {
      if (!isGangneung(item, def)) continue;
      if (def.needsEmergencyBell && String(item.emcy_bl_instl_yn ?? '').toUpperCase() !== 'Y') continue;
      const address = valueOf(item, def.addressFields);
      const coords = coordinatesFromItem(item, def) ?? await geocodeAddress(address);
      if (!coords) continue;
      points.push({
        id: `${def.featureId}:safemap:${def.code}:${String(item.objt_id ?? item.num ?? `${coords.lat},${coords.lng}`)}`,
        name: valueOf(item, def.nameFields) || def.category,
        lat: coords.lat,
        lng: coords.lng,
        featureId: def.featureId,
        category: def.category,
        address,
        source: `생활안전정보 ${def.code}`,
        weight: def.weight,
        nightWeight: def.nightWeight,
      });
    }
    pageNo++;
  }

  return mergePoints(points);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).end(); return; }

  try {
    const results = await Promise.all(API_DEFS.map(async (def) => ({ def, items: await fetchApiItems(def) })));
    const items = mergePoints(results.flatMap((result) => result.items));
    res.status(200).json({
      source: '생활안전정보 API',
      city: '강원특별자치도 강릉시',
      counts: Object.fromEntries(results.map((result) => [result.def.featureId, result.items.length])),
      items,
    });
  } catch (error) {
    res.status(500).json({ error: String(error), items: [] });
  }
}
