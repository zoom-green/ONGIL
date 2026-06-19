import type { LatLng, Place, RouteCandidate, RouteNode, CctvPoint, SafeSpot, StreetlightPoint } from '../types';
import { calcSafetyScore, distanceMeters, findSafeWaypoints, hasBacktracking } from './safety';

const TMAP_KEY = import.meta.env.VITE_TMAP_KEY as string;
const TMAP_URL = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json';

interface TmapFeature {
  type: string;
  geometry: { type: string; coordinates: number[] | number[][] };
  properties: {
    totalDistance?: number;
    totalTime?: number;
    streetName?: string; // Point 피처의 도로명 (큰길 판별용)
  };
}

async function callTmapPedestrian(
  origin: LatLng,
  destination: LatLng,
  passList?: LatLng
): Promise<{ nodes: RouteNode[]; totalDistance: number; totalTime: number }> {
  const body: Record<string, string> = {
    startX: String(origin.lng),
    startY: String(origin.lat),
    endX: String(destination.lng),
    endY: String(destination.lat),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    startName: '출발지',
    endName: '목적지',
  };

  if (passList) {
    // TMAP passList 형식: "경도,위도" (단일 경유지)
    body.passList = `${passList.lng},${passList.lat}`;
  }

  const res = await fetch(TMAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', appKey: TMAP_KEY },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`TMAP error ${res.status}`);

  const data: { features: TmapFeature[] } = await res.json();
  const nodes: RouteNode[] = [];
  let totalDistance = 0;
  let totalTime = 0;
  let currentMainRoad = false; // Point 피처 순서대로 이후 LineString에 적용

  for (const f of data.features) {
    if (f.geometry.type === 'Point') {
      // T-map 방향 안내 피처에서 도로명 추출 → "로"/"대로" 포함 시 큰길 표시
      const street = f.properties.streetName ?? '';
      currentMainRoad = street.length > 0 && (street.includes('대로') || street.includes('로'));
    }
    if (f.geometry.type === 'LineString') {
      for (const [lng, lat] of f.geometry.coordinates as number[][]) {
        nodes.push({ lat, lng, mainRoad: currentMainRoad });
      }
    }
    if (f.properties.totalDistance) totalDistance = f.properties.totalDistance;
    if (f.properties.totalTime) totalTime = f.properties.totalTime;
  }

  if (nodes.length === 0) throw new Error('TMAP 경로 노드 없음');
  return { nodes, totalDistance, totalTime };
}

// 두 경로가 실질적으로 동일한지 비교 (중간 + 1/4 지점 모두 40m 이내면 동일 경로)
function routesAreSame(a: RouteNode[], b: RouteNode[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const midA = a[Math.floor(a.length / 2)];
  const midB = b[Math.floor(b.length / 2)];
  if (distanceMeters(midA, midB) >= 40) return false;
  const q1A = a[Math.floor(a.length / 4)];
  const q1B = b[Math.floor(b.length / 4)];
  return distanceMeters(q1A, q1B) < 40;
}

export async function fetchPedestrianRoutes(
  origin: LatLng,
  destination: LatLng,
  cctvList: CctvPoint[],
  safeSpots: SafeSpot[],
  streetlights: StreetlightPoint[] = []
): Promise<RouteCandidate[]> {
  // 경로 A: 직선 최단 (빠른길 기반)
  const rawA = await callTmapPedestrian(origin, destination);
  const scoreA = calcSafetyScore(rawA.nodes, cctvList, safeSpots, streetlights);

  // 상위 2개 경유지 후보 탐색 후 병렬 요청 — 더 많은 안전 경로 탐색
  const waypoints = findSafeWaypoints(rawA.nodes, cctvList, safeSpots, 2);

  let rawB = rawA;
  let scoreB = scoreA;

  if (waypoints.length > 0) {
    const waypointResults = await Promise.allSettled(
      waypoints.map((wp) => callTmapPedestrian(origin, destination, wp))
    );

    for (const result of waypointResults) {
      if (result.status !== 'fulfilled') continue;
      const candidate = result.value;
      const detourRatio =
        rawA.totalDistance > 0 ? candidate.totalDistance / rawA.totalDistance : 1;
      // 동일 경로이거나 우회 25% 초과 → 기각 (기존 35%에서 강화)
      if (routesAreSame(rawA.nodes, candidate.nodes) || detourRatio > 1.25) continue;
      // 골목 진입 후 되돌아 나오는 U턴·대폭 우회 패턴 → 기각
      if (hasBacktracking(candidate.nodes, 0.15)) continue;

      const scoreC = calcSafetyScore(candidate.nodes, cctvList, safeSpots, streetlights);
      // 직선 경로(scoreA) 대비 최소 15% 이상 안전해야 채택 (조금 돌아가는 게 의미 있으려면 확실히 더 안전해야 함)
      if (scoreC.score < scoreA.score * 1.15) continue;
      // 현재 최선 안심길보다도 안전 점수 높아야 교체
      if (scoreC.score > scoreB.score) {
        rawB = candidate;
        scoreB = scoreC;
      }
    }
  }

  const candidateA: RouteCandidate = {
    nodes: rawA.nodes,
    totalDistance: rawA.totalDistance,
    totalTime: rawA.totalTime,
    safetyScore: scoreA.score,
    cctvCount: scoreA.cctvCount,
    safeSpotCount: scoreA.safeSpotCount,
  };

  const candidateB: RouteCandidate = {
    nodes: rawB.nodes,
    totalDistance: rawB.totalDistance,
    totalTime: rawB.totalTime,
    safetyScore: scoreB.score,
    cctvCount: scoreB.cctvCount,
    safeSpotCount: scoreB.safeSpotCount,
  };

  return [candidateA, candidateB];
}

// 강릉 바운딩박스 내 T-map POI 키워드 검색 (카카오 커버리지 보완용)
export async function searchTmapPOI(keyword: string): Promise<Place[]> {
  if (!TMAP_KEY || !keyword.trim()) return [];
  try {
    const params = new URLSearchParams({
      version: '1',
      searchKeyword: keyword,
      searchType: 'all',
      page: '1',
      count: '5',
      resCoordType: 'WGS84GEO',
      reqCoordType: 'WGS84GEO',
      areaLLPointx: '128.82',
      areaLLPointy: '37.70',
      areaURPointx: '128.96',
      areaURPointy: '37.82',
    });
    const res = await fetch(`https://apis.openapi.sk.com/tmap/pois?${params}`, {
      headers: { appKey: TMAP_KEY },
    });
    if (!res.ok) return [];
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pois: any[] = data?.searchPoiInfo?.pois?.poi ?? [];
    return pois
      .filter((p) => p.noorLat && p.noorLon)
      .map((p) => ({
        name: p.name || p.poiname || '',
        address: [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.detailAddrName]
          .filter(Boolean)
          .join(' ')
          .trim(),
        position: { lat: parseFloat(p.noorLat), lng: parseFloat(p.noorLon) },
      }))
      .filter((p) => p.name && !isNaN(p.position.lat) && !isNaN(p.position.lng));
  } catch {
    return [];
  }
}
