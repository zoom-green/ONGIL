import {
  pickSafestRoute,
  scoreRoute,
  scoreRouteCandidate,
  tier1ContinuityScore,
  tier1Coverage,
  tier2CountScore,
} from '../src/utils/safety';
import type { LatLng, SafetyElement } from '../src/types';

const METERS_PER_DEGREE = 111320;

function north(meters: number): LatLng {
  return { lat: 37 + meters / METERS_PER_DEGREE, lng: 127 };
}

function route(lengthMeters: number): LatLng[] {
  return [north(0), north(lengthMeters)];
}

function offsetRoute(lengthMeters: number): LatLng[] {
  return [
    { lat: 37, lng: 127.001 },
    { lat: 37 + lengthMeters / METERS_PER_DEGREE, lng: 127.001 },
  ];
}

function tier1(id: string, type: 'CCTV' | 'streetlight', meters: number): SafetyElement {
  return { id, type, position: north(meters) };
}

function offsetTier1(id: string, type: 'CCTV' | 'streetlight', meters: number): SafetyElement {
  return { id, type, position: { lat: 37 + meters / METERS_PER_DEGREE, lng: 127.001 } };
}

function tier2(id: string, type: SafetyElement['type'], meters: number): SafetyElement {
  return { id, type, position: north(meters) };
}

function fullTier1CoverageElements(prefix = ''): SafetyElement[] {
  return [
    tier1(`${prefix}cctv-a`, 'CCTV', 0),
    tier1(`${prefix}cctv-b`, 'CCTV', 40),
    tier1(`${prefix}cctv-c`, 'CCTV', 80),
    tier1(`${prefix}cctv-d`, 'CCTV', 100),
    tier1(`${prefix}light-a`, 'streetlight', 0),
    tier1(`${prefix}light-b`, 'streetlight', 25),
    tier1(`${prefix}light-c`, 'streetlight', 50),
    tier1(`${prefix}light-d`, 'streetlight', 75),
    tier1(`${prefix}light-e`, 'streetlight', 100),
  ];
}

describe('safe route scoring', () => {
  test('tier1Coverage: full coverage is 1.0 and one 60m CCTV gap is below 1.0', () => {
    expect(tier1Coverage(route(100), fullTier1CoverageElements(), 'CCTV', 50)).toBeCloseTo(1);

    const cctvGap = [
      tier1('cctv-a', 'CCTV', 0),
      tier1('cctv-b', 'CCTV', 60),
    ];
    expect(tier1Coverage(route(60), cctvGap, 'CCTV', 50)).toBeLessThan(1);
  });

  test('tier1ContinuityScore averages streetlight and CCTV coverage', () => {
    const cctvOnly = [
      tier1('cctv-a', 'CCTV', 0),
      tier1('cctv-b', 'CCTV', 40),
      tier1('cctv-c', 'CCTV', 80),
      tier1('cctv-d', 'CCTV', 100),
    ];

    expect(tier1ContinuityScore(route(100), cctvOnly)).toBeCloseTo(0.5);
    expect(tier1ContinuityScore(route(100), fullTier1CoverageElements())).toBeCloseTo(1);
  });

  test('tier2CountScore counts all Tier-2 types equally and saturates at 15', () => {
    const elements: SafetyElement[] = [
      tier2('store', 'convenience_store', 10),
      tier2('food', 'cafe_restaurant', 15),
      tier2('police', 'police', 20),
      tier2('fire', 'fire_station', 25),
      tier2('guardian', 'safety_guardian_house', 30),
      tier2('bell', 'emergency_bell', 35),
      tier2('medical', 'emergency_medical', 40),
    ];
    expect(tier2CountScore(route(100), elements)).toBeCloseTo(7 / 15);

    const saturated = Array.from({ length: 18 }, (_, index): SafetyElement => (
      tier2(`store-${index}`, 'convenience_store', 5 + index)
    ));
    expect(tier2CountScore(route(100), saturated)).toBe(1);
  });

  test('scoreRoute uses 0.7 tier1 + 0.3 tier2 arithmetic', () => {
    const elements = [
      ...fullTier1CoverageElements(),
      ...Array.from({ length: 5 }, (_, index): SafetyElement => (
        tier2(`store-${index}`, 'convenience_store', 10 + index)
      )),
    ];
    const score = scoreRoute(route(100), elements);

    expect(score.tier1ContinuityScore).toBeCloseTo(1);
    expect(score.tier2CountScore).toBeCloseTo(5 / 15);
    expect(score.safetyScore).toBeCloseTo((0.7 * 1) + (0.3 * (5 / 15)));
  });

  test('pickSafestRoute: higher safety score wins even if the route is longer', () => {
    const shortUnsafe = route(80);
    const longSafe = offsetRoute(120);
    const elements = [
      offsetTier1('cctv-a', 'CCTV', 0),
      offsetTier1('cctv-b', 'CCTV', 40),
      offsetTier1('cctv-c', 'CCTV', 80),
      offsetTier1('cctv-d', 'CCTV', 120),
      offsetTier1('light-a', 'streetlight', 0),
      offsetTier1('light-b', 'streetlight', 25),
      offsetTier1('light-c', 'streetlight', 50),
      offsetTier1('light-d', 'streetlight', 75),
      offsetTier1('light-e', 'streetlight', 100),
      offsetTier1('light-f', 'streetlight', 120),
    ];

    expect(pickSafestRoute([shortUnsafe, longSafe], elements)).toBe(longSafe);
  });

  test('pickSafestRoute: equal score uses shorter distance as tie-breaker', () => {
    const shortRoute = route(90);
    const longRoute = route(120);

    expect(pickSafestRoute([longRoute, shortRoute], [])).toBe(shortRoute);
  });

  test('safe route differs from fastest route when a safer alternative exists', () => {
    const fastest = route(80);
    const saferAlternative = offsetRoute(120);
    const elements = [
      offsetTier1('cctv-a', 'CCTV', 0),
      offsetTier1('cctv-b', 'CCTV', 40),
      offsetTier1('cctv-c', 'CCTV', 80),
      offsetTier1('cctv-d', 'CCTV', 120),
      offsetTier1('light-a', 'streetlight', 0),
      offsetTier1('light-b', 'streetlight', 25),
      offsetTier1('light-c', 'streetlight', 50),
      offsetTier1('light-d', 'streetlight', 75),
      offsetTier1('light-e', 'streetlight', 100),
      offsetTier1('light-f', 'streetlight', 120),
    ];

    const safe = pickSafestRoute([fastest, saferAlternative], elements);
    const fast = [fastest, saferAlternative].sort((a, b) => scoreRoute(a, []).distanceMeters - scoreRoute(b, []).distanceMeters)[0];

    expect(fast).toBe(fastest);
    expect(safe).toBe(saferAlternative);
  });

  test('scoreRouteCandidate keeps route card counts while using weighted safety score', () => {
    const scored = scoreRouteCandidate({
      nodes: route(100),
      totalDistance: 100,
      totalTime: 120,
      safetyScore: 0,
      cctvCount: 0,
      safeSpotCount: 0,
    }, [
      tier1('cctv-a', 'CCTV', 10),
      tier2('store-a', 'convenience_store', 20),
      tier2('store-b', 'convenience_store', 30),
      tier2('food-a', 'cafe_restaurant', 40),
      tier2('police-a', 'police', 50),
    ]);

    expect(scored.safetyScore).toBeGreaterThanOrEqual(0);
    expect(scored.cctvCount).toBe(1);
    expect(scored.tier2Count).toBe(4);
    expect(scored.featureCounts).toMatchObject({
      cctv: 1,
      convenience: 2,
      food: 1,
      police: 1,
    });
  });
});
