export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place {
  name: string;
  address: string;
  position: LatLng;
}

export interface CctvPoint {
  lat: number;
  lng: number;
}

export interface StreetlightPoint {
  lat: number;
  lng: number;
}

export interface ChildSafeHousePoint {
  name: string;
  lat: number;
  lng: number;
  address: string;
}

export interface SafeSpot {
  name: string;
  lat: number;
  lng: number;
  category: string;
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
}

export interface RouteResult {
  safeRoute: RouteCandidate;
  fastRoute: RouteCandidate;
}
