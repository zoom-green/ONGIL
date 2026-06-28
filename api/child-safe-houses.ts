import https from 'https';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SAFEDREAM_API_URL = 'https://www.safe182.go.kr/api/lcm/safeMap.do';
const VWORLD_DATA_API_URL = 'https://api.vworld.kr/req/data';

interface SafeDreamItem {
  lcSn?: number | string;
  bsshNm?: string;
  telno?: string | null;
  adres?: string;
  lcinfoLa?: number | string;
  lcinfoLo?: number | string;
  clNm?: string;
}

interface VworldFeature {
  id?: string;
  geometry?: {
    type?: string;
    coordinates?: [number, number];
  };
  properties?: {
    cat_nam?: string;
    fac_nam?: string;
    fac_tel?: string;
    fac_o_add?: string;
    fac_n_add?: string;
  };
}

interface ChildSafeHouseApiItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  categoryName: string;
  phone?: string;
  source: string;
}

function cleanPhone(phone: string | null | undefined): string | undefined {
  if (!phone || phone.replace(/[-\s]/g, '') === '') return undefined;
  return phone;
}

function toSafeDreamItem(item: SafeDreamItem): ChildSafeHouseApiItem | null {
  const lat = Number(item.lcinfoLa);
  const lng = Number(item.lcinfoLo);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address = item.adres ?? '';
  if (!address.includes('\uAC15\uB989\uC2DC')) return null;

  return {
    id: String(item.lcSn ?? `${lat},${lng}`),
    name: item.bsshNm ?? '\uC544\uB3D9\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
    lat,
    lng,
    address,
    categoryName: item.clNm ?? '\uC544\uB3D9\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
    phone: cleanPhone(item.telno),
    source: '\uC548\uC804Dream',
  };
}

function toVworldItem(feature: VworldFeature): ChildSafeHouseApiItem | null {
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const properties = feature.properties ?? {};
  const address = properties.fac_n_add || properties.fac_o_add || '';
  if (!address.includes('\uAC15\uB989\uC2DC')) return null;

  return {
    id: String(feature.id ?? `${lat},${lng}`),
    name: properties.fac_nam ?? '\uC544\uB3D9\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
    lat,
    lng,
    address,
    categoryName: properties.cat_nam ?? '\uC544\uB3D9\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
    phone: cleanPhone(properties.fac_tel),
    source: '\uAD6D\uD1A0\uAD50\uD1B5\uBD80',
  };
}

function normalizePlaceKey(value: string): string {
  return value.replace(/\s+/g, '').replace(/[-,._()]/g, '').toLowerCase();
}

function distanceMeters(a: ChildSafeHouseApiItem, b: ChildSafeHouseApiItem): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isSamePlace(a: ChildSafeHouseApiItem, b: ChildSafeHouseApiItem): boolean {
  const nameA = normalizePlaceKey(a.name);
  const nameB = normalizePlaceKey(b.name);
  const addressA = normalizePlaceKey(a.address);
  const addressB = normalizePlaceKey(b.address);
  if (nameA && nameA === nameB) return true;
  if (addressA && addressA === addressB) return true;
  return distanceMeters(a, b) <= 20;
}

function mergeItems(items: ChildSafeHouseApiItem[]): ChildSafeHouseApiItem[] {
  return items.reduce<ChildSafeHouseApiItem[]>((merged, item) => {
    if (!merged.some((existing) => isSamePlace(existing, item))) {
      merged.push(item);
    }
    return merged;
  }, []);
}

function fetchJsonWithInsecureAgent<T>(url: string): Promise<T> {
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
            reject(new Error(`Request failed: ${upstream.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e);
          }
        });
      }
    ).on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const esntlId = process.env.SAFEDREAM_ESNTL_ID;
  const authKey = process.env.SAFEDREAM_AUTH_KEY;
  const vworldKey = process.env.VWORLD_API_KEY;
  const vworldDomain = process.env.VWORLD_API_DOMAIN ?? 'http://localhost';
  if (!esntlId || !authKey || !vworldKey) {
    res.status(500).json({ error: 'SAFEDREAM_ESNTL_ID, SAFEDREAM_AUTH_KEY, and VWORLD_API_KEY are required' });
    return;
  }

  const safeDreamParams = new URLSearchParams({
    esntlId,
    authKey,
    pageIndex: '1',
    pageUnit: '100',
    clArray: '09',
    minY: '37.55',
    minX: '128.70',
    maxY: '37.95',
    maxX: '129.10',
  });
  const vworldParams = new URLSearchParams({
    service: 'data',
    version: '2.0',
    request: 'GetFeature',
    key: vworldKey,
    domain: vworldDomain,
    data: 'LT_P_MGPRTFA',
    format: 'json',
    size: '1000',
    page: '1',
    crs: 'EPSG:4326',
    geomFilter: 'BOX(128.70,37.55,129.10,37.95)',
  });

  try {
    const [safeDreamData, vworldData] = await Promise.all([
      fetchJsonWithInsecureAgent<{ list?: SafeDreamItem[] }>(`${SAFEDREAM_API_URL}?${safeDreamParams}`),
      fetchJsonWithInsecureAgent<{
        response?: {
          status?: string;
          error?: { text?: string };
          result?: { featureCollection?: { features?: VworldFeature[] } };
        };
      }>(`${VWORLD_DATA_API_URL}?${vworldParams}`),
    ]);

    if (vworldData.response?.status !== 'OK') {
      res.status(502).json({ error: vworldData.response?.error?.text ?? 'VWorld request failed' });
      return;
    }

    const safeDreamItems = (safeDreamData.list ?? [])
      .map(toSafeDreamItem)
      .filter((item): item is ChildSafeHouseApiItem => Boolean(item));
    const vworldItems = (vworldData.response?.result?.featureCollection?.features ?? [])
      .map(toVworldItem)
      .filter((item): item is ChildSafeHouseApiItem => Boolean(item));
    const items = mergeItems([...safeDreamItems, ...vworldItems]);

    res.status(200).json({
      source: '\uC548\uC804Dream \uC548\uC804\uC9C0\uD0B4\uC774\uC9D1 API + \uAD6D\uD1A0\uAD50\uD1B5\uBD80 VWorld 2D Data API',
      sourceCategory: '\uC544\uB3D9\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
      counts: {
        safeDream: safeDreamItems.length,
        molit: vworldItems.length,
        merged: items.length,
      },
      items,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
