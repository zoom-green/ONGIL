import type {
  CctvPoint,
  LatLng,
  Place,
  RouteCandidate,
  RouteNode,
  SafeSpot,
  SafetyElement,
  SafetyFeatureId,
  SafetyPoint,
  StreetlightPoint,
} from '../types';
import {
  distanceMeters,
  pickSafestRouteCandidate,
  safetyPointsToElements,
  scoreRouteCandidate,
} from './safety';

const TMAP_KEY = import.meta.env.VITE_TMAP_KEY as string;
const TMAP_URL = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json';
const fastRouteCache = new Map<string, RouteCandidate>();

interface TmapFeature {
  type: string;
  geometry: { type: string; coordinates: number[] | number[][] };
  properties: {
    totalDistance?: number;
    totalTime?: number;
    streetName?: string;
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
    startName: 'start',
    endName: 'destination',
    searchOption: '0',
  };

  if (passList) body.passList = `${passList.lng},${passList.lat}`;

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
  let currentMainRoad = false;

  for (const feature of data.features) {
    if (feature.geometry.type === 'Point') {
      const street = feature.properties.streetName ?? '';
      currentMainRoad = street.length > 0 && (street.includes('대로') || street.includes('로'));
    }
    if (feature.geometry.type === 'LineString') {
      for (const [lng, lat] of feature.geometry.coordinates as number[][]) {
        nodes.push({ lat, lng, mainRoad: currentMainRoad });
      }
    }
    if (feature.properties.totalDistance) totalDistance = feature.properties.totalDistance;
    if (feature.properties.totalTime) totalTime = feature.properties.totalTime;
  }

  if (nodes.length === 0) throw new Error('TMAP route nodes missing');
  return { nodes, totalDistance, totalTime };
}

function fastRouteCacheKey(origin: LatLng, destination: LatLng): string {
  return [
    origin.lat.toFixed(6),
    origin.lng.toFixed(6),
    destination.lat.toFixed(6),
    destination.lng.toFixed(6),
  ].join(',');
}

function rawToRoute(raw: { nodes: RouteNode[]; totalDistance: number; totalTime: number }): RouteCandidate {
  return {
    nodes: raw.nodes,
    totalDistance: raw.totalDistance,
    totalTime: raw.totalTime,
    safetyScore: 0,
    cctvCount: 0,
    safeSpotCount: 0,
    featureCounts: {},
  };
}

function routesAreSame(a: RouteNode[], b: RouteNode[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const midA = a[Math.floor(a.length / 2)];
  const midB = b[Math.floor(b.length / 2)];
  if (distanceMeters(midA, midB) >= 40) return false;
  const q1A = a[Math.floor(a.length / 4)];
  const q1B = b[Math.floor(b.length / 4)];
  return distanceMeters(q1A, q1B) < 40;
}

function routeProgress(point: LatLng, nodes: RouteNode[]): number {
  let bestDistance = Infinity;
  let bestIndex = 0;
  for (let index = 0; index < nodes.length; index += 4) {
    const distance = distanceMeters(point, nodes[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return nodes.length > 1 ? bestIndex / (nodes.length - 1) : 0;
}

function minDistanceToRoute(point: LatLng, nodes: RouteNode[]): number {
  let min = Infinity;
  for (let index = 0; index < nodes.length; index += 4) {
    min = Math.min(min, distanceMeters(point, nodes[index]));
  }
  return min;
}

function buildCandidateWaypoints(baseline: RouteCandidate, elements: SafetyElement[]): LatLng[] {
  const seenBuckets = new Set<string>();
  return elements
    .map((element) => ({
      position: element.position,
      progress: routeProgress(element.position, baseline.nodes),
      distanceToRoute: minDistanceToRoute(element.position, baseline.nodes),
    }))
    .filter((candidate) => candidate.progress >= 0.08 && candidate.progress <= 0.92)
    .filter((candidate) => candidate.distanceToRoute >= 25 && candidate.distanceToRoute <= 180)
    .filter((candidate) => {
      const bucket = `${Math.round(candidate.progress * 20)}:${Math.round(candidate.position.lat * 5000)}:${Math.round(candidate.position.lng * 5000)}`;
      if (seenBuckets.has(bucket)) return false;
      seenBuckets.add(bucket);
      return true;
    })
    .sort((a, b) => a.progress - b.progress || a.distanceToRoute - b.distanceToRoute)
    .slice(0, 8)
    .map((candidate) => candidate.position);
}

async function buildSafeRouteCandidates(
  origin: LatLng,
  destination: LatLng,
  baseline: RouteCandidate,
  elements: SafetyElement[]
): Promise<RouteCandidate[]> {
  const waypoints = buildCandidateWaypoints(baseline, elements);
  const rawResults = await Promise.allSettled(
    waypoints.map((waypoint) => callTmapPedestrian(origin, destination, waypoint))
  );
  const candidates = [baseline];

  for (const result of rawResults) {
    if (result.status !== 'fulfilled') continue;
    const candidate = rawToRoute(result.value);
    if (routesAreSame(baseline.nodes, candidate.nodes)) continue;
    candidates.push(candidate);
  }

  return candidates;
}

export async function fetchFastPedestrianRoute(
  origin: LatLng,
  destination: LatLng
): Promise<RouteCandidate> {
  const cacheKey = fastRouteCacheKey(origin, destination);
  const cached = fastRouteCache.get(cacheKey);
  if (cached) return cached;

  const route = rawToRoute(await callTmapPedestrian(origin, destination));
  fastRouteCache.set(cacheKey, route);
  return route;
}

export async function fetchSelectedPedestrianRoutes(
  origin: LatLng,
  destination: LatLng,
  safetyPoints: SafetyPoint[],
  selectedFeatures: SafetyFeatureId[],
  baselineRoute?: RouteCandidate
): Promise<RouteCandidate[]> {
  const baseline = baselineRoute ?? await fetchFastPedestrianRoute(origin, destination);
  const elements = safetyPointsToElements(safetyPoints, selectedFeatures);
  const candidates = await buildSafeRouteCandidates(origin, destination, baseline, elements);
  const scoredCandidates = candidates.map((candidate) => scoreRouteCandidate(candidate, elements));
  const safeRoute = pickSafestRouteCandidate(scoredCandidates, elements);
  const fastRoute = scoreRouteCandidate(baseline, elements);
  return [safeRoute, fastRoute];
}

export async function fetchPedestrianRoutes(
  origin: LatLng,
  destination: LatLng,
  cctvList: CctvPoint[],
  safeSpots: SafeSpot[],
  streetlights: StreetlightPoint[] = []
): Promise<RouteCandidate[]> {
  const baseline = await fetchFastPedestrianRoute(origin, destination);
  const elements: SafetyElement[] = [
    ...cctvList.map((point, index) => ({
      id: `cctv:${index}:${point.lat}:${point.lng}`,
      type: 'CCTV' as const,
      position: { lat: point.lat, lng: point.lng },
    })),
    ...streetlights.map((point, index) => ({
      id: `streetlight:${index}:${point.lat}:${point.lng}`,
      type: 'streetlight' as const,
      position: { lat: point.lat, lng: point.lng },
    })),
    ...safeSpots.map((point, index) => ({
      id: `spot:${index}:${point.lat}:${point.lng}`,
      type: 'convenience_store' as const,
      position: { lat: point.lat, lng: point.lng },
    })),
  ];
  const candidates = await buildSafeRouteCandidates(origin, destination, baseline, elements);
  const safeRoute = pickSafestRouteCandidate(candidates, elements);
  const fastRoute = scoreRouteCandidate(baseline, elements);
  return [safeRoute, fastRoute];
}

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
    const pois: unknown[] = data?.searchPoiInfo?.pois?.poi ?? [];
    return pois
      .map((poi) => poi as Record<string, string | undefined>)
      .filter((poi) => poi.noorLat && poi.noorLon)
      .map((poi) => ({
        name: poi.name || poi.poiname || '',
        address: [poi.upperAddrName, poi.middleAddrName, poi.lowerAddrName, poi.detailAddrName]
          .filter(Boolean)
          .join(' ')
          .trim(),
        position: { lat: Number(poi.noorLat), lng: Number(poi.noorLon) },
      }))
      .filter((place) => place.name && Number.isFinite(place.position.lat) && Number.isFinite(place.position.lng));
  } catch {
    return [];
  }
}
