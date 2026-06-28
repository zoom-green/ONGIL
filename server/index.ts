import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import https from 'https';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const REALTIME_MODEL = 'gpt-realtime-2';
const SAFEDREAM_API_URL = 'https://www.safe182.go.kr/api/lcm/safeMap.do';
const VWORLD_DATA_API_URL = 'https://api.vworld.kr/req/data';
const SAFEMAP_SERVICE_KEY = process.env.SAFEMAP_SERVICE_KEY ?? 'G6JN4CFY-G6JN-G6JN-G6JN-G6JN4CFY8E';
const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY ?? process.env.VITE_KAKAO_REST_KEY;

app.use(cors({ origin: ['http://localhost:5173', 'capacitor://localhost', 'ionic://localhost'] }));
app.use(express.text({ type: ['application/sdp', 'text/plain'], limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

type Persona = 'mom' | 'dad' | 'brother';

const PERSONA_VOICES: Record<Persona, string> = {
  mom: 'marin',
  dad: 'cedar',
  brother: 'verse',
};

const PERSONA_INSTRUCTIONS: Record<Persona, string> = {
  mom: `당신은 사용자와 전화하듯 대화하는 엄마입니다.
항상 한국어로만 말합니다.
따뜻하고 걱정 많은 자연스러운 반말을 씁니다.
답변은 보통 1~2문장으로 짧게 말합니다.
"무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않습니다.
자신이 AI라는 사실을 먼저 말하지 않고 엄마 역할을 유지합니다.
사용자가 짧게 답해도 자연스럽게 다음 말을 이어갑니다.`,

  dad: `당신은 사용자와 전화하듯 대화하는 아빠입니다.
항상 한국어로만 말합니다.
무뚝뚝하지만 든든하고 걱정이 묻어나는 반말을 씁니다.
답변은 보통 1~2문장으로 짧고 간결하게 말합니다.
"무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않습니다.
자신이 AI라는 사실을 먼저 말하지 않고 아빠 역할을 유지합니다.
사용자가 짧게 답해도 담백하게 다음 말을 이어갑니다.`,

  brother: `당신은 사용자와 전화하듯 대화하는 오빠입니다.
항상 한국어로만 말합니다.
장난스럽고 편하지만 사용자를 챙기는 보호자 같은 반말을 씁니다.
답변은 보통 1~2문장으로 짧게 말합니다.
"무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않습니다.
자신이 AI라는 사실을 먼저 말하지 않고 오빠 역할을 유지합니다.
사용자가 짧게 답해도 자연스럽게 대화를 이어갑니다.`,
};

function parsePersona(value: unknown): Persona {
  return value === 'dad' || value === 'brother' ? value : 'mom';
}

function buildRealtimeSession(persona: Persona) {
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: PERSONA_INSTRUCTIONS[persona],
    audio: {
      input: {
        turn_detection: {
          type: 'server_vad',
          threshold: 0.78,
          prefix_padding_ms: 300,
          silence_duration_ms: 900,
        },
      },
      output: {
        voice: PERSONA_VOICES[persona],
      },
    },
  };
}

// ─── 카카오 운영시간 프록시 ───────────────────────────────────
app.get('/api/hours', (req, res) => {
  const placeId = req.query.placeId as string;
  if (!placeId) { res.status(400).json({ error: 'placeId required' }); return; }

  const url = `https://place.map.kakao.com/main/v/${placeId}`;
  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://map.kakao.com/',
    },
  }, (kakaoRes) => {
    let body = '';
    kakaoRes.on('data', (chunk) => { body += chunk; });
    kakaoRes.on('end', () => {
      try { res.json({ openHour: JSON.parse(body)?.basicInfo?.openHour ?? null }); }
      catch { res.json({ openHour: null }); }
    });
  }).on('error', () => res.json({ openHour: null }));
});

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

function cleanSafeDreamPhone(phone: string | null | undefined): string | undefined {
  if (!phone || phone.replace(/[-\s]/g, '') === '') return undefined;
  return phone;
}

function toSafeDreamChildSafeHouse(item: SafeDreamItem): ChildSafeHouseApiItem | null {
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
    phone: cleanSafeDreamPhone(item.telno),
    source: '\uC548\uC804Dream',
  };
}

function toVworldChildSafeHouse(feature: VworldFeature): ChildSafeHouseApiItem | null {
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
    phone: cleanSafeDreamPhone(properties.fac_tel),
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

function mergeChildSafeHouses(items: ChildSafeHouseApiItem[]): ChildSafeHouseApiItem[] {
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

app.get('/api/child-safe-houses', async (_req, res) => {
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
      .map(toSafeDreamChildSafeHouse)
      .filter((item): item is ChildSafeHouseApiItem => Boolean(item));
    const vworldItems = (vworldData.response?.result?.featureCollection?.features ?? [])
      .map(toVworldChildSafeHouse)
      .filter((item): item is ChildSafeHouseApiItem => Boolean(item));
    const items = mergeChildSafeHouses([...safeDreamItems, ...vworldItems]);

    res.json({
      source: '\uC548\uC804Dream \uC548\uC804\uC9C0\uD0B4\uC774\uC9D1 API + \uAD6D\uD1A0\uAD50\uD1B5\uBD80 VWorld 2D Data API',
      sourceCategory: '\uC544\uB3D9\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
      counts: {
        safeDream: safeDreamItems.length,
        molit: vworldItems.length,
        merged: items.length,
      },
      items,
    });
  } catch (error) {
    res.status(500).json({ error: String(error), items: [] });
  }
});

async function fetchLifeApiItems(def: LifeApiDef): Promise<LifeSafetyPoint[]> {
  const pageSize = 1000;
  let pageNo = 1;
  let totalCount = Infinity;
  const points: LifeSafetyPoint[] = [];

  while ((pageNo - 1) * pageSize < totalCount && pageNo <= 20) {
    const params = new URLSearchParams({
      serviceKey: SAFEMAP_SERVICE_KEY,
      pageNo: String(pageNo),
      numOfRows: String(pageSize),
      type: 'json',
    });
    const data = await fetchJsonWithInsecureAgent<{
      header?: { resultCode?: string; resultMsg?: string };
      body?: { totalCount?: number; items?: { item?: Record<string, unknown>[] | Record<string, unknown> } };
    }>(`https://safemap.go.kr/openapi2/${def.code}?${params}`);
    if (data.header?.resultCode && data.header.resultCode !== '00') throw new Error(`${def.code}: ${data.header.resultMsg ?? data.header.resultCode}`);
    totalCount = Number(data.body?.totalCount ?? 0);
    const raw = data.body?.items?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    for (const item of items) {
      if (!isGangneungLifeItem(item, def)) continue;
      if (def.needsEmergencyBell && String(item.emcy_bl_instl_yn ?? '').toUpperCase() !== 'Y') continue;
      const address = lifeValueOf(item, def.addressFields);
      const coords = lifeCoordinatesFromItem(item, def) ?? await geocodeLifeAddress(address);
      if (!coords) continue;
      points.push({
        id: `${def.featureId}:safemap:${def.code}:${String(item.objt_id ?? item.num ?? `${coords.lat},${coords.lng}`)}`,
        name: lifeValueOf(item, def.nameFields) || def.category,
        lat: coords.lat,
        lng: coords.lng,
        featureId: def.featureId,
        category: def.category,
        address,
        source: `Life Safety API ${def.code}`,
        weight: def.weight,
        nightWeight: def.nightWeight,
      });
    }
    pageNo++;
  }
  return mergeLifePoints(points);
}

app.get('/api/life-safety', async (_req, res) => {
  try {
    const results = await Promise.all(LIFE_API_DEFS.map(async (def) => ({ def, items: await fetchLifeApiItems(def) })));
    const items = mergeLifePoints(results.flatMap((result) => result.items));
    res.json({
      source: 'Life Safety API',
      city: 'Gangneung',
      counts: Object.fromEntries(results.map((result) => [result.def.featureId, result.items.length])),
      items,
    });
  } catch (error) {
    res.status(500).json({ error: String(error), items: [] });
  }
});

app.get('/api/life-safety-old', async (_req, res) => {
  try {
    const validation = await new Promise<{ statusCode: number; contentType: string; body: string }>((resolve, reject) => {
      https.get(
        SAFEMAP_VALIDATION_URL,
        {
          agent: new https.Agent({ rejectUnauthorized: false }),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        },
        (upstream) => {
          let body = '';
          upstream.on('data', (chunk) => { body += chunk; });
          upstream.on('end', () => resolve({
            statusCode: upstream.statusCode ?? 500,
            contentType: String(upstream.headers['content-type'] ?? ''),
            body,
          }));
        }
      ).on('error', reject);
    });
    const keyRejected = validation.body.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
    res.json({
      source: 'Life Safety API',
      city: 'Gangneung',
      counts: {
        police: 0,
        fire: 0,
        securityLight: 0,
        medical: 0,
        toiletWithEmergencyBell: 0,
      },
      items: [],
      warning: keyRejected
        ? 'Life Safety API service key is not registered.'
        : 'Life Safety API validation passed, but no mapped JSON items were returned.',
      validation: {
        statusCode: validation.statusCode,
        contentType: validation.contentType,
      },
    });
  } catch (error) {
    res.json({
      source: 'Life Safety API',
      city: 'Gangneung',
      counts: {},
      items: [],
      warning: `Life Safety API check failed: ${String(error)}`,
    });
  }
});

// ─── OpenAI Realtime 음성 대화 연결 ───────────────────────────────
app.post('/api/realtime-call', async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: 'OPENAI_API_KEY missing' }); return; }
  if (typeof req.body !== 'string' || !req.body.trim()) {
    res.status(400).json({ error: 'SDP offer required' });
    return;
  }

  const persona = parsePersona(req.query.persona);
  const formData = new FormData();
  formData.set('sdp', req.body);
  formData.set('session', JSON.stringify(buildRealtimeSession(persona)));

  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    });

    const answerSdp = await upstream.text();
    if (!upstream.ok) {
      res.status(upstream.status).send(answerSdp || 'OpenAI Realtime connection failed');
      return;
    }

    res.setHeader('Content-Type', 'application/sdp');
    res.status(200).send(answerSdp);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`[Ongil server] http://localhost:${PORT}`));

