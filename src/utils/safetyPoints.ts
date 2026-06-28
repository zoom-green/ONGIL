import type {
  CctvPoint,
  ChildSafeHousePoint,
  SafeSpot,
  SafetyFeatureId,
  SafetyPoint,
  StreetlightPoint,
  WeeklyHours,
} from '../types';
import { distanceMeters } from './safety';
import { getSafetyFeature } from './safetyFeatures';

interface GyodongFoodPlace {
  place_id?: string;
  name?: string;
  category?: 'cafe' | 'restaurant';
  lat?: number;
  lng?: number;
  weekly_hours?: WeeklyHours;
  business_status?: string;
  confidence?: string;
  last_verified_at?: string;
  source_url?: string;
}

interface LifeSafetyResponse {
  items?: SafetyPoint[];
}

let cachedGyodongFood: SafetyPoint[] | null = null;
let cachedLifeSafety: SafetyPoint[] | null = null;

function normalizeText(value = ''): string {
  return value.replace(/\s+/g, '').replace(/[-,._()]/g, '').toLowerCase();
}

function isSamePoint(a: SafetyPoint, b: SafetyPoint): boolean {
  if (a.featureId !== b.featureId) return false;
  const nameA = normalizeText(a.name);
  const nameB = normalizeText(b.name);
  const addrA = normalizeText(a.address);
  const addrB = normalizeText(b.address);
  if (addrA && addrA === addrB) return true;
  if (nameA && nameA === nameB && distanceMeters(a, b) <= 80) return true;
  return distanceMeters(a, b) <= 20;
}

export function mergeSafetyPoints(items: SafetyPoint[]): SafetyPoint[] {
  return items.reduce<SafetyPoint[]>((merged, item) => {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return merged;
    if (!merged.some((existing) => isSamePoint(existing, item))) merged.push(item);
    return merged;
  }, []);
}

export function cctvToSafetyPoints(cctvList: CctvPoint[]): SafetyPoint[] {
  const config = getSafetyFeature('cctv');
  return cctvList.map((point, index) => ({
    id: `cctv:${point.lat.toFixed(6)},${point.lng.toFixed(6)}:${index}`,
    name: point.name ?? 'CCTV',
    lat: point.lat,
    lng: point.lng,
    featureId: 'cctv',
    category: config.label,
    source: point.source ?? 'Gangneung CCTV',
    weight: config.weight,
    nightWeight: config.nightWeight,
  }));
}

export function streetlightsToSafetyPoints(streetlights: StreetlightPoint[]): SafetyPoint[] {
  const config = getSafetyFeature('light');
  return streetlights.map((point, index) => ({
    id: `light:${point.lat.toFixed(6)},${point.lng.toFixed(6)}:${index}`,
    name: point.name ?? (point.kind === 'securityLight' ? 'Security light' : 'Streetlight'),
    lat: point.lat,
    lng: point.lng,
    featureId: 'light',
    category: config.label,
    source: point.source ?? 'Gangneung streetlight',
    weight: config.weight,
    nightWeight: config.nightWeight,
  }));
}

export function kakaoSafeSpotsToSafetyPoints(spots: SafeSpot[]): SafetyPoint[] {
  return spots.flatMap((spot, index) => {
    const categoryText = `${spot.category} ${spot.name}`;
    let featureId: SafetyFeatureId | null = spot.featureId ?? null;
    if (!featureId && /\ud3b8\uc758\uc810/.test(categoryText)) featureId = 'convenience';
    if (!featureId && /(\uce74\ud398|\uc74c\uc2dd|\uc2dd\ub2f9|\ub9db\uc9d1)/.test(categoryText)) featureId = 'food';
    if (!featureId && /(\uacbd\ucc30|\uc9c0\uad6c\ub300|\ud30c\ucd9c\uc18c|\uce58\uc548)/.test(categoryText)) featureId = 'police';
    if (!featureId && /(\uc18c\ubc29|119)/.test(categoryText)) featureId = 'fire';
    if (!featureId && /(\ubcd1\uc6d0|\uc751\uae09|\uc758\ub8cc)/.test(categoryText)) featureId = 'medical';
    if (!featureId) return [];

    const config = getSafetyFeature(featureId);
    return [{
      id: `${featureId}:kakao:${spot.lat.toFixed(6)},${spot.lng.toFixed(6)}:${index}`,
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      featureId,
      category: config.label,
      source: 'Kakao Map',
      weight: spot.weight ?? config.weight,
      nightWeight: spot.nightWeight ?? config.nightWeight,
    }];
  });
}

export function childSafeHousesToSafetyPoints(houses: ChildSafeHousePoint[]): SafetyPoint[] {
  const config = getSafetyFeature('childSafeHouse');
  return houses.map((house) => ({
    id: `childSafeHouse:${house.id}`,
    name: house.name,
    lat: house.lat,
    lng: house.lng,
    featureId: 'childSafeHouse',
    category: config.label,
    displayLabel: house.name,
    address: house.address,
    source: house.source,
    weight: config.weight,
    nightWeight: config.nightWeight,
  }));
}

export async function loadGyodongFoodSafetyPoints(): Promise<SafetyPoint[]> {
  if (cachedGyodongFood) return cachedGyodongFood;
  try {
    const res = await fetch('/data/gangneung_gyodong_food_safe_route_places.json');
    if (!res.ok) return [];
    const data = await res.json();
    const places: GyodongFoodPlace[] = Array.isArray(data?.places) ? data.places : [];
    const config = getSafetyFeature('food');
    cachedGyodongFood = places
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
      .map((place, index) => ({
        id: `food:gyodong:${place.place_id ?? index}`,
        name: place.name ?? (place.category === 'cafe' ? 'Cafe' : 'Restaurant'),
        lat: Number(place.lat),
        lng: Number(place.lng),
        featureId: 'food',
        category: config.label,
        source: place.source_url ? `Kakao Map ${place.source_url}` : 'Kakao Map Gyodong',
        weight: config.weight,
        nightWeight: config.nightWeight,
        weeklyHours: place.weekly_hours,
        businessStatus: place.business_status,
        confidence: place.confidence,
        lastVerifiedAt: place.last_verified_at,
        sourceUrl: place.source_url,
      }));
    return cachedGyodongFood;
  } catch {
    return [];
  }
}

export const loadGyo1FoodSafetyPoints = loadGyodongFoodSafetyPoints;

export async function fetchLifeSafetyPoints(): Promise<SafetyPoint[]> {
  if (cachedLifeSafety) return cachedLifeSafety;
  try {
    const res = await fetch('/data/life-safety-gangneung.json');
    if (!res.ok) return [];
    const data: LifeSafetyResponse = await res.json();
    cachedLifeSafety = Array.isArray(data.items) ? data.items : [];
    return cachedLifeSafety;
  } catch {
    return [];
  }
}
