import type {
  DarkZone,
  LatLng,
  RouteCandidate,
  RouteNode,
  RouteSafetyScore,
  SafetyElement,
  SafetyElementType,
  SafetyFeatureId,
  SafetyPoint,
  Tier1ElementType,
  WeekdayKey,
} from '../types';

const EARTH_RADIUS_M = 6371000;
const TIER1_THRESHOLDS_M: Record<Tier1ElementType, number> = {
  streetlight: 30,
  CCTV: 50,
};
const TIER2_ROUTE_RADIUS_M = 30;
const DAY_KEYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const TIER1_TYPES = new Set<SafetyElementType>(['CCTV', 'streetlight']);

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function toXY(point: LatLng, origin: LatLng): { x: number; y: number } {
  const lat = toRad(point.lat);
  const lng = toRad(point.lng);
  const originLat = toRad(origin.lat);
  const originLng = toRad(origin.lng);
  return {
    x: (lng - originLng) * Math.cos((lat + originLat) / 2) * EARTH_RADIUS_M,
    y: (lat - originLat) * EARTH_RADIUS_M,
  };
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const x = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export const distanceMeters = haversineMeters;

function parseClock(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours === 24 && minutes === 0) return 24 * 60;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isSafetyPointAvailable(point: SafetyPoint, at = new Date()): boolean {
  if (point.featureId !== 'food') return true;
  if (point.businessStatus && point.businessStatus !== 'active') return false;
  if (point.confidence !== 'estimated') return false;

  const dayKey = DAY_KEYS[at.getDay()];
  const ranges = point.weeklyHours?.[dayKey] ?? [];
  if (!ranges.length) return false;

  const now = at.getHours() * 60 + at.getMinutes();
  return ranges.some((range) => {
    const open = parseClock(range.open);
    const close = parseClock(range.close);
    if (open === null || close === null) return false;
    if (close === 24 * 60) return now >= open;
    if (close <= open) return now >= open || now < close;
    return now >= open && now < close;
  });
}

export function routeLengthMeters(polyline: LatLng[]): number {
  let total = 0;
  for (let index = 1; index < polyline.length; index += 1) {
    total += haversineMeters(polyline[index - 1], polyline[index]);
  }
  return total;
}

function cumulativeDistances(polyline: LatLng[]): number[] {
  const distances = [0];
  for (let index = 1; index < polyline.length; index += 1) {
    distances[index] = distances[index - 1] + haversineMeters(polyline[index - 1], polyline[index]);
  }
  return distances;
}

function pointAtDistance(polyline: LatLng[], distanceMetersAlongRoute: number): LatLng {
  if (polyline.length === 0) return { lat: 0, lng: 0 };
  if (polyline.length === 1 || distanceMetersAlongRoute <= 0) return polyline[0];

  let travelled = 0;
  for (let index = 1; index < polyline.length; index += 1) {
    const from = polyline[index - 1];
    const to = polyline[index];
    const segmentLength = haversineMeters(from, to);
    if (travelled + segmentLength >= distanceMetersAlongRoute) {
      const t = segmentLength === 0 ? 0 : (distanceMetersAlongRoute - travelled) / segmentLength;
      return {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      };
    }
    travelled += segmentLength;
  }

  return polyline[polyline.length - 1];
}

function nearestProjectionOnRoute(point: LatLng, polyline: LatLng[]): { distanceToRoute: number; routeDistance: number } {
  if (polyline.length === 0) return { distanceToRoute: Infinity, routeDistance: 0 };
  if (polyline.length === 1) {
    return { distanceToRoute: haversineMeters(point, polyline[0]), routeDistance: 0 };
  }

  const origin = point;
  const cumulative = cumulativeDistances(polyline);
  let bestDistance = Infinity;
  let bestRouteDistance = 0;

  for (let index = 1; index < polyline.length; index += 1) {
    const a = toXY(polyline[index - 1], origin);
    const b = toXY(polyline[index], origin);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const rawT = len2 === 0 ? 0 : -(a.x * dx + a.y * dy) / len2;
    const t = Math.max(0, Math.min(1, rawT));
    const projectedX = a.x + dx * t;
    const projectedY = a.y + dy * t;
    const distanceToRoute = Math.hypot(projectedX, projectedY);
    const segmentLength = cumulative[index] - cumulative[index - 1];
    const routeDistance = cumulative[index - 1] + segmentLength * t;

    if (distanceToRoute < bestDistance) {
      bestDistance = distanceToRoute;
      bestRouteDistance = routeDistance;
    }
  }

  return { distanceToRoute: bestDistance, routeDistance: bestRouteDistance };
}

export function minDistToRoute(point: LatLng, nodes: RouteNode[]): number {
  return nearestProjectionOnRoute(point, nodes).distanceToRoute;
}

function isTier1(type: SafetyElementType): type is Tier1ElementType {
  return TIER1_TYPES.has(type);
}

function isTier2(type: SafetyElementType): boolean {
  return !isTier1(type);
}

export function projectTier1(
  polyline: LatLng[],
  elements: SafetyElement[]
): Map<Tier1ElementType, number[]> {
  const projected = new Map<Tier1ElementType, number[]>([
    ['CCTV', []],
    ['streetlight', []],
  ]);

  for (const element of elements) {
    if (!isTier1(element.type)) continue;
    const projection = nearestProjectionOnRoute(element.position, polyline);
    if (projection.distanceToRoute > TIER1_THRESHOLDS_M[element.type]) continue;
    projected.get(element.type)?.push(projection.routeDistance);
  }

  for (const values of projected.values()) {
    values.sort((a, b) => a - b);
  }

  return projected;
}

export function findDarkZones(polyline: LatLng[], elements: SafetyElement[]): DarkZone[] {
  const routeLength = routeLengthMeters(polyline);
  if (polyline.length < 2 || routeLength <= 0) return [];

  const projected = projectTier1(polyline, elements);
  const darkZones: DarkZone[] = [];

  for (const [elementType, positions] of projected) {
    if (!elements.some((element) => element.type === elementType)) continue;
    const threshold = TIER1_THRESHOLDS_M[elementType];
    const checkpoints = [0, ...positions, routeLength];

    for (let index = 1; index < checkpoints.length; index += 1) {
      const fromDistance = checkpoints[index - 1];
      const toDistance = checkpoints[index];
      const gap = toDistance - fromDistance;
      if (gap <= threshold) continue;
      darkZones.push({
        from: pointAtDistance(polyline, fromDistance),
        to: pointAtDistance(polyline, toDistance),
        distanceMeters: gap,
        elementType,
      });
    }
  }

  return darkZones;
}

export function countTier2NearRoute(
  polyline: LatLng[],
  elements: SafetyElement[],
  radiusMeters = TIER2_ROUTE_RADIUS_M
): number {
  const counted = new Set<string>();

  for (const element of elements) {
    if (!isTier2(element.type)) continue;
    const projection = nearestProjectionOnRoute(element.position, polyline);
    if (projection.distanceToRoute <= radiusMeters) counted.add(element.id);
  }

  return counted.size;
}

export function scoreRoute(polyline: LatLng[], elements: SafetyElement[]): RouteSafetyScore {
  const darkZones = findDarkZones(polyline, elements);
  return {
    darkZoneCount: darkZones.length,
    tier2Count: countTier2NearRoute(polyline, elements),
    distanceMeters: routeLengthMeters(polyline),
    darkZones,
  };
}

export function compareRouteSafety(a: RouteSafetyScore, b: RouteSafetyScore): number {
  if (a.darkZoneCount !== b.darkZoneCount) return a.darkZoneCount - b.darkZoneCount;
  if (a.tier2Count !== b.tier2Count) return b.tier2Count - a.tier2Count;
  return a.distanceMeters - b.distanceMeters;
}

export function pickSafestRoute(candidates: LatLng[][], elements: SafetyElement[]): LatLng[] {
  return [...candidates].sort((a, b) => compareRouteSafety(scoreRoute(a, elements), scoreRoute(b, elements)))[0] ?? [];
}

export function safetyPointToElement(point: SafetyPoint): SafetyElement | null {
  const typeByFeature: Partial<Record<SafetyFeatureId, SafetyElementType>> = {
    cctv: 'CCTV',
    light: 'streetlight',
    convenience: 'convenience_store',
    food: 'cafe_restaurant',
    police: 'police',
    fire: 'fire_station',
    childSafeHouse: 'safety_guardian_house',
    toilet: 'emergency_bell',
    medical: 'emergency_medical',
  };
  const type = typeByFeature[point.featureId];
  if (!type) return null;
  return {
    id: point.id,
    type,
    position: { lat: point.lat, lng: point.lng },
  };
}

export function safetyPointsToElements(
  points: SafetyPoint[],
  selectedFeatures: SafetyFeatureId[]
): SafetyElement[] {
  const selected = new Set(selectedFeatures);
  return points
    .filter((point) => selected.has(point.featureId))
    .map(safetyPointToElement)
    .filter((element): element is SafetyElement => element !== null);
}

export function scoreRouteCandidate(
  route: RouteCandidate,
  elements: SafetyElement[]
): RouteCandidate {
  const score = scoreRoute(route.nodes, elements);
  return {
    ...route,
    safetyScore: -score.darkZoneCount,
    cctvCount: countTier1NearRoute(route.nodes, elements, 'CCTV'),
    safeSpotCount: score.tier2Count,
    darkZoneCount: score.darkZoneCount,
    tier2Count: score.tier2Count,
    darkZones: score.darkZones,
  };
}

export function pickSafestRouteCandidate(candidates: RouteCandidate[], elements: SafetyElement[]): RouteCandidate {
  return [...candidates]
    .map((candidate) => scoreRouteCandidate(candidate, elements))
    .sort((a, b) => compareRouteSafety(routeCandidateScore(a), routeCandidateScore(b)))[0];
}

function routeCandidateScore(route: RouteCandidate): RouteSafetyScore {
  return {
    darkZoneCount: route.darkZoneCount ?? 0,
    tier2Count: route.tier2Count ?? route.safeSpotCount,
    distanceMeters: route.totalDistance,
    darkZones: route.darkZones ?? [],
  };
}

function countTier1NearRoute(polyline: LatLng[], elements: SafetyElement[], type: Tier1ElementType): number {
  const counted = new Set<string>();
  for (const element of elements) {
    if (element.type !== type) continue;
    const projection = nearestProjectionOnRoute(element.position, polyline);
    if (projection.distanceToRoute <= TIER1_THRESHOLDS_M[type]) counted.add(element.id);
  }
  return counted.size;
}

export function collectSelectedRouteSafetyPoints(
  nodes: RouteNode[],
  points: SafetyPoint[],
  selectedFeatures: SafetyFeatureId[]
): SafetyPoint[] {
  const selected = new Set(selectedFeatures);
  return points.filter((point) => {
    if (!selected.has(point.featureId)) return false;
    const element = safetyPointToElement(point);
    if (!element) return false;
    const radius = isTier1(element.type) ? TIER1_THRESHOLDS_M[element.type] : TIER2_ROUTE_RADIUS_M;
    return nearestProjectionOnRoute(point, nodes).distanceToRoute <= radius;
  });
}

export function pickBestRoute(candidates: RouteCandidate[]): {
  safeRoute: RouteCandidate;
  fastRoute: RouteCandidate;
} {
  const safeRoute = [...candidates].sort((a, b) => {
    const aScore = routeCandidateScore(a);
    const bScore = routeCandidateScore(b);
    return compareRouteSafety(aScore, bScore);
  })[0];
  const fastRoute = [...candidates].sort((a, b) => a.totalDistance - b.totalDistance)[0];
  return { safeRoute, fastRoute };
}
