import type { RouteNode, CctvPoint, SafeSpot, StreetlightPoint, RouteCandidate, SafetyFeatureId, SafetyPoint, WeekdayKey } from '../types';
import { getSafetyFeature } from './safetyFeatures';

const CCTV_RADIUS_M = 50;
const SPOT_RADIUS_M = 80;

function safetyRadiusMeters(featureId: SafetyFeatureId): number {
  if (featureId === 'light') return LIGHT_RADIUS_M;
  if (featureId === 'cctv') return CCTV_RADIUS_M;
  return SPOT_RADIUS_M;
}
const DAY_KEYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LIGHT_RADIUS_M = 40; // 가로등/스마트보안등 커버 반경

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const x = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function routeLengthMeters(nodes: RouteNode[]): number {
  let total = 0;
  for (let i = 1; i < nodes.length; i++) {
    total += distanceMeters(nodes[i - 1], nodes[i]);
  }
  return total || 1;
}

const isNight = (): boolean => {
  const h = new Date().getHours();
  return h >= 19 || h < 6;
};

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

function isEmergency(category: string): boolean {
  return ['경찰', '지구대', '파출소', '소방'].some((k) => category.includes(k));
}

export function calcSafetyScore(
  nodes: RouteNode[],
  cctvList: CctvPoint[],
  safeSpots: SafeSpot[],
  streetlights: StreetlightPoint[] = []
): { score: number; cctvCount: number; safeSpotCount: number } {
  const night = isNight();
  const wCctv  = night ? 3 : 1;   // CCTV:  야간 3배 (기존 2배)
  const wLight = night ? 3 : 0.5; // 가로등: 야간 3배 (기존 2배), 주간 0.5
  const wRoad  = night ? 2 : 1;   // 큰길:  야간 2배, 주간 1 (신규)

  let cctvScore = 0;
  let spotScore = 0;
  let lightScore = 0;
  let roadScore = 0;

  // 동일 CCTV·거점이 여러 노드에 걸쳐 중복 카운트되지 않도록 Set으로 추적
  const seenCctv = new Set<number>();
  const seenSpot = new Set<number>();

  const sampled = nodes.filter((_, i) => i % 3 === 0);

  for (const node of sampled) {
    cctvList.forEach((c, idx) => {
      if (distanceMeters(node, c) <= CCTV_RADIUS_M) {
        cctvScore += wCctv; // 점수는 밀도 기반으로 노드마다 누적
        seenCctv.add(idx);  // 표시용 개수는 고유 인덱스만
      }
    });

    safeSpots.forEach((spot, idx) => {
      if (distanceMeters(node, spot) <= SPOT_RADIUS_M) {
        const w = night ? (spot.nightWeight ?? spot.weight ?? 1) : (spot.weight ?? 1);
        spotScore += w;
        seenSpot.add(idx);
      }
    });

    for (const light of streetlights) {
      if (distanceMeters(node, light) <= LIGHT_RADIUS_M) {
        lightScore += wLight;
      }
    }

    // 큰길(로/대로) 구간 보너스
    if (node.mainRoad) roadScore += wRoad;
  }

  const cctvCount = seenCctv.size;
  const safeSpotCount = seenSpot.size;

  const len = routeLengthMeters(nodes);
  const score = ((cctvScore + spotScore + lightScore + roadScore) / len) * 1000;

  return { score, cctvCount, safeSpotCount };
}

export function calcSelectedSafetyScore(
  nodes: RouteNode[],
  points: SafetyPoint[],
  selectedFeatures: SafetyFeatureId[]
): { score: number; cctvCount: number; safeSpotCount: number; featureCounts: Partial<Record<SafetyFeatureId, number>> } {
  const selected = new Set(selectedFeatures);
  const night = isNight();
  const sampled = nodes.filter((_, i) => i % 3 === 0);
  const seen = new Set<string>();
  const featureCounts: Partial<Record<SafetyFeatureId, number>> = {};
  let pointScore = 0;
  let roadScore = 0;
  let currentUncovered = 0;
  let longestUncovered = 0;

  for (const node of sampled) {
    const bestByFeature = new Map<SafetyFeatureId, { point: SafetyPoint; score: number }>();

    for (const point of points) {
      if (!selected.has(point.featureId)) continue;
      if (!isSafetyPointAvailable(point)) continue;
      const radius = safetyRadiusMeters(point.featureId);
      const dist = distanceMeters(node, point);
      if (dist > radius) continue;

      const config = getSafetyFeature(point.featureId);
      const baseWeight = night ? (point.nightWeight ?? config.nightWeight) : (point.weight ?? config.weight);
      const closeness = 1 - Math.min(dist / radius, 1) * 0.45;
      const score = baseWeight * closeness;
      const current = bestByFeature.get(point.featureId);
      if (!current || score > current.score) bestByFeature.set(point.featureId, { point, score });
    }

    if (bestByFeature.size === 0) {
      currentUncovered += 1;
      longestUncovered = Math.max(longestUncovered, currentUncovered);
    } else {
      currentUncovered = 0;
    }

    for (const item of bestByFeature.values()) {
      pointScore += item.score;
      seen.add(item.point.id);
    }
    if (node.mainRoad) roadScore += night ? 2 : 1;
  }

  for (const point of points) {
    if (!seen.has(point.id)) continue;
    featureCounts[point.featureId] = (featureCounts[point.featureId] ?? 0) + 1;
  }

  const len = routeLengthMeters(nodes);
  const gapPenalty = longestUncovered * (night ? 2.4 : 1.2);
  const score = (Math.max(0, pointScore + roadScore - gapPenalty) / len) * 1000;
  return {
    score,
    cctvCount: featureCounts.cctv ?? 0,
    safeSpotCount: seen.size - (featureCounts.cctv ?? 0),
    featureCounts,
  };
}

export function collectSelectedRouteSafetyPoints(
  nodes: RouteNode[],
  points: SafetyPoint[],
  selectedFeatures: SafetyFeatureId[]
): SafetyPoint[] {
  const selected = new Set(selectedFeatures);
  const night = isNight();
  const sampled = nodes.filter((_, i) => i % 3 === 0);
  const seen = new Set<string>();

  for (const node of sampled) {
    const bestByFeature = new Map<SafetyFeatureId, { point: SafetyPoint; score: number }>();

    for (const point of points) {
      if (!selected.has(point.featureId)) continue;
      if (!isSafetyPointAvailable(point)) continue;
      const radius = safetyRadiusMeters(point.featureId);
      const dist = distanceMeters(node, point);
      if (dist > radius) continue;

      const config = getSafetyFeature(point.featureId);
      const baseWeight = night ? (point.nightWeight ?? config.nightWeight) : (point.weight ?? config.weight);
      const closeness = 1 - Math.min(dist / radius, 1) * 0.45;
      const score = baseWeight * closeness;
      const current = bestByFeature.get(point.featureId);
      if (!current || score > current.score) bestByFeature.set(point.featureId, { point, score });
    }

    for (const item of bestByFeature.values()) {
      seen.add(item.point.id);
    }
  }

  return points.filter((point) => seen.has(point.id));
}

export function pickBestRoute(candidates: RouteCandidate[]): {
  safeRoute: RouteCandidate;
  fastRoute: RouteCandidate;
} {
  const sorted = [...candidates].sort((a, b) => b.safetyScore - a.safetyScore);
  const safeRoute = sorted[0];
  const fastRoute = [...candidates].sort((a, b) => a.totalDistance - b.totalDistance)[0];
  return { safeRoute, fastRoute };
}

// 경로 상의 점들과의 최소 거리 계산
export function minDistToRoute(point: { lat: number; lng: number }, nodes: RouteNode[]): number {
  let min = Infinity;
  for (let i = 0; i < nodes.length; i += 4) {
    const d = distanceMeters(point, nodes[i]);
    if (d < min) min = d;
  }
  return min;
}

// 후보 점을 출발-목적지 직선에 투영한 파라미터 t 계산 (0=출발, 1=목적지)
function getProjectionT(
  point: { lat: number; lng: number },
  origin: RouteNode,
  dest: RouteNode
): number {
  const rdx = dest.lng - origin.lng;
  const rdy = dest.lat - origin.lat;
  const len2 = rdx * rdx + rdy * rdy;
  if (len2 < 1e-20) return 0.5;
  const pdx = point.lng - origin.lng;
  const pdy = point.lat - origin.lat;
  return (pdx * rdx + pdy * rdy) / len2;
}

// 경유지 탐색 — 목적지 방향 안에 있는 안전 스팟, 상위 count개 반환
export function findSafeWaypoints(
  nodes: RouteNode[],
  _cctvList: CctvPoint[],
  safeSpots: SafeSpot[],
  count = 3
): { lat: number; lng: number }[] {
  if (nodes.length < 6) return [];

  const origin = nodes[0];
  const dest = nodes[nodes.length - 1];

  const eligible = safeSpots
    .filter((s) => !isEmergency(s.category))
    .map((s) => ({
      point: { lat: s.lat, lng: s.lng },
      t: getProjectionT(s, origin, dest),
      distToRoute: minDistToRoute(s, nodes),
      weight: s.weight ?? 1,
    }))
    .filter((c) => {
      // 출발~목적지 구간의 10%~90% 사이에 위치 (반대 방향·목적지 너머 제외)
      if (c.t < 0.1 || c.t > 0.9) return false;
      // 경로에서 20~100m 이내 (너무 멀면 T-map이 대폭 우회 경로 생성)
      if (c.distToRoute < 20 || c.distToRoute > 100) return false;
      return true;
    })
    // 가중치 높은 것 우선, 동점이면 경로에 가까운 것
    .sort((a, b) => b.weight - a.weight || a.distToRoute - b.distToRoute);

  return eligible.slice(0, count).map((c) => c.point);
}

export function findSelectedSafeWaypoints(
  nodes: RouteNode[],
  points: SafetyPoint[],
  selectedFeatures: SafetyFeatureId[],
  count = 3
): { lat: number; lng: number }[] {
  if (nodes.length < 6) return [];
  const selected = new Set(selectedFeatures);
  const origin = nodes[0];
  const dest = nodes[nodes.length - 1];

  return points
    .filter((point) => selected.has(point.featureId))
    .filter((point) => isSafetyPointAvailable(point))
    .map((point) => ({
      point: { lat: point.lat, lng: point.lng },
      t: getProjectionT(point, origin, dest),
      distToRoute: minDistToRoute(point, nodes),
      weight: (isNight() ? point.nightWeight : point.weight) ?? getSafetyFeature(point.featureId).weight,
    }))
    .filter((candidate) => candidate.t >= 0.1 && candidate.t <= 0.9)
    .filter((candidate) => candidate.distToRoute >= 20 && candidate.distToRoute <= 85)
    .sort((a, b) => b.weight - a.weight || a.distToRoute - b.distToRoute)
    .slice(0, count)
    .map((candidate) => candidate.point);
}

// 경로가 "골목 진입 후 되돌아 나오는" U턴 패턴인지 검사
// t값(0=출발, 1=도착 방향 투영값)이 peak 대비 maxRatio 이상 후퇴하면 true
export function hasBacktracking(nodes: RouteNode[], maxBacktrackRatio = 0.20): boolean {
  if (nodes.length < 4) return false;
  const origin = nodes[0];
  const dest = nodes[nodes.length - 1];
  let peak = getProjectionT(nodes[0], origin, dest);
  for (const node of nodes) {
    const t = getProjectionT(node, origin, dest);
    if (t > peak) {
      peak = t;
    } else if (peak - t > maxBacktrackRatio) {
      return true; // 전진하다 20% 이상 역방향으로 되돌아가면 U턴
    }
  }
  return false;
}

// 하위 호환용 단일 반환 래퍼
export function findSafeWaypoint(
  nodes: RouteNode[],
  cctvList: CctvPoint[],
  safeSpots: SafeSpot[]
): { lat: number; lng: number } | null {
  const results = findSafeWaypoints(nodes, cctvList, safeSpots, 1);
  return results.length > 0 ? results[0] : null;
}
