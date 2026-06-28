export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapBounds {
  sw: LatLng;
  ne: LatLng;
  center: LatLng;
}

export type SafetyFeatureId =
  | 'cctv'
  | 'food'
  | 'convenience'
  | 'police'
  | 'fire'
  | 'light'
  | 'childSafeHouse'
  | 'medical'
  | 'toilet';

export interface SafetyFeatureConfig {
  id: SafetyFeatureId;
  label: string;
  iconFile?: string;
  color: string;
  weight: number;
  nightWeight: number;
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface OpeningHourRange {
  open: string;
  close: string;
}

export type WeeklyHours = Partial<Record<WeekdayKey, OpeningHourRange[]>>;

export interface SafetyPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  featureId: SafetyFeatureId;
  category: string;
  displayLabel?: string;
  address?: string;
  source?: string;
  weight?: number;
  nightWeight?: number;
  weeklyHours?: WeeklyHours;
  businessStatus?: string;
  confidence?: string;
  lastVerifiedAt?: string;
  sourceUrl?: string;
}

export interface Place {
  name: string;
  address: string;
  position: LatLng;
}

export interface CctvPoint {
  lat: number;
  lng: number;
  name?: string;
  source?: string;
}

export interface StreetlightPoint {
  lat: number;
  lng: number;
  name?: string;
  source?: string;
  kind?: 'streetlight' | 'securityLight';
}

export interface ChildSafeHousePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  categoryName: string;
  phone?: string;
  source?: string;
}

export interface SafeSpot {
  name: string;
  lat: number;
  lng: number;
  category: string;
  featureId?: SafetyFeatureId;
  weight?: number;      // 주간 가중치
  nightWeight?: number; // 야간 가중치
}

export interface RouteNode {
  lat: number;
  lng: number;
  mainRoad?: boolean; // T-map "로/대로" 구간 여부
}

export interface RouteCandidate {
  nodes: RouteNode[];
  totalDistance: number;
  totalTime: number;
  safetyScore: number;
  cctvCount: number;
  safeSpotCount: number;
  featureCounts?: Partial<Record<SafetyFeatureId, number>>;
}

export interface RouteResult {
  safeRoute: RouteCandidate;
  fastRoute: RouteCandidate;
}
