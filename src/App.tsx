import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import KakaoMap from './components/KakaoMap';
import { startTransition } from 'react';
import SearchBar from './components/SearchBar';
import RouteCard from './components/RouteCard';
import CompanionCall from './components/CompanionCall';
import type { CompanionDisplayMode } from './components/CompanionCall';
import EmergencyScreen from './components/EmergencyScreen';
import SettingsModal from './components/SettingsModal';
import { useUserLocation } from './hooks/useUserLocation';
import type { LatLng, MapBounds, Place, RouteCandidate, CctvPoint, SafeSpot, StreetlightPoint, ChildSafeHousePoint, SafetyFeatureConfig, SafetyFeatureId, SafetyPoint } from './types';
import { fetchFastPedestrianRoute, fetchSelectedPedestrianRoutes } from './utils/tmap';
import { loadCctvData } from './utils/cctv';
import { loadStreetlightData } from './utils/streetlight';
import { fetchSafeSpots, fetchSafeSpotsInBounds } from './utils/kakaoLocal';
import { fetchChildSafeHouses } from './utils/childSafeHouses';
import { pickBestRoute, distanceMeters, minDistToRoute, isSafetyPointAvailable, collectSelectedRouteSafetyPoints } from './utils/safety';
import { GANGNEUNG_CCTV_FALLBACK } from './data/cctvFallback';
import { useShakeDetection } from './hooks/useShakeDetection';
import { sendGuardianSMSAll, buildGuardianMessage } from './utils/sms';
import { type Persona, PERSONA_DESCRIPTIONS, PERSONA_EMOJI, PERSONA_LABELS } from './utils/companionPersona';
import { DEFAULT_SELECTED_FEATURES, SAFETY_FEATURES, getSafetyFeature } from './utils/safetyFeatures';
import {
  cctvToSafetyPoints,
  streetlightsToSafetyPoints,
  kakaoSafeSpotsToSafetyPoints,
  childSafeHousesToSafetyPoints,
  loadGyodongFoodSafetyPoints,
  fetchLifeSafetyPoints,
  mergeSafetyPoints,
} from './utils/safetyPoints';

const GUARDIAN_STORAGE_KEY = 'ongil_guardian_phones_v2';
const SETTINGS_STORAGE_KEY = 'ongil_safety_settings_v1';
const CRIME_WMS_KEY = 'W5ZQMXVH-W5ZQ-W5ZQ-W5ZQ-W5ZQMXVHPG';
const GANGNEUNG_CENTER: LatLng = { lat: 37.7519, lng: 128.8761 };
const EMPTY_SAFETY_POINTS: SafetyPoint[] = [];
const EMPTY_WMS_LAYERS: string[] = [];

type AppStep = 'search' | 'routes';

interface SafetySettings {
  safeRouteEnabled: boolean;
  selectedFeatures: SafetyFeatureId[];
  shareIntervalMinutes: 2 | 4 | 8;
}

function formatRouteTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes}분`;
}

function loadSafetySettings(): SafetySettings {
  const fallback: SafetySettings = {
    safeRouteEnabled: false,
    selectedFeatures: DEFAULT_SELECTED_FEATURES,
    shareIntervalMinutes: 4,
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '');
    const selected = Array.isArray(parsed?.selectedFeatures)
      ? parsed.selectedFeatures.filter((id: string) => SAFETY_FEATURES.some((feature) => feature.id === id))
      : fallback.selectedFeatures;
    return {
      safeRouteEnabled: Boolean(parsed?.safeRouteEnabled),
      selectedFeatures: selected.length > 0 ? selected : fallback.selectedFeatures,
      shareIntervalMinutes: parsed?.shareIntervalMinutes === 2 || parsed?.shareIntervalMinutes === 8 ? parsed.shareIntervalMinutes : 4,
    };
  } catch {
    return fallback;
  }
}

function loadGuardianPhones(): [string, string] {
  const stored = localStorage.getItem(GUARDIAN_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return [parsed[0] ?? '', parsed[1] ?? ''];
    } catch {}
  }
  // ?댁쟾 踰꾩쟾 ?⑥씪 踰덊샇 留덉씠洹몃젅?댁뀡
  const old = localStorage.getItem('ongil_guardian_phone') ?? '';
  return [old, ''];
}

export default function App() {
  const [kakaoReady, setKakaoReady] = useState(false);
  const [kakaoError, setKakaoError] = useState<string | null>(null);
  const [step, setStep] = useState<AppStep>('search');
  const [userPos, setUserPos] = useState<LatLng>(GANGNEUNG_CENTER);

  const [gpsOrigin, setGpsOrigin] = useState<LatLng | null>(null);
  const [manualOrigin, setManualOrigin] = useState<Place | null>(null);
  // 寃쎈줈 怨꾩궛 ??뺤젙?출발吏 ?GPS ?깅쭏?蹂?섎뒗 effectiveOrigin ??KakaoMap??꾨떖
  const [lockedOrigin, setLockedOrigin] = useState<LatLng | null>(null);

  const effectiveOrigin: LatLng | null = manualOrigin?.position ?? gpsOrigin;

  const [destination, setDestination] = useState<Place | null>(null);
  const [safeRoute, setSafeRoute] = useState<RouteCandidate | null>(null);
  const [fastRoute, setFastRoute] = useState<RouteCandidate | null>(null);
  const [activeRoute, setActiveRoute] = useState<'safe' | 'fast'>('safe');
  const [cctvList, setCctvList] = useState<CctvPoint[]>(GANGNEUNG_CCTV_FALLBACK);
  const [safeSpots, setSafeSpots] = useState<SafeSpot[]>([]);
  const [viewportSafeSpots, setViewportSafeSpots] = useState<SafeSpot[]>([]);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [streetlightData, setStreetlightData] = useState<StreetlightPoint[]>([]);
  const [childSafeHouses, setChildSafeHouses] = useState<ChildSafeHousePoint[]>([]);
  const [gyodongFoodPoints, setGyodongFoodPoints] = useState<SafetyPoint[]>([]);
  const [lifeSafetyPoints, setLifeSafetyPoints] = useState<SafetyPoint[]>([]);
  const [safetySettings, setSafetySettings] = useState<SafetySettings>(loadSafetySettings);
  const [showOverlays] = useState(true);
  const [visibleFeatures, setVisibleFeatures] = useState<Record<SafetyFeatureId, boolean>>(() =>
    Object.fromEntries(SAFETY_FEATURES.map((feature) => [feature.id, false])) as Record<SafetyFeatureId, boolean>
  );
  const [childSafeHouseError, setChildSafeHouseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapClickInfo, setMapClickInfo] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [routesPanelCollapsed, setRoutesPanelCollapsed] = useState(false);

  // ?ㅼ떆媛?GPS 異붿쟻 ??watchPosition 湲곕컲, heading ?ы븿
  const { location: userLocation, ready: locationReady } = useUserLocation();
  const [companionDisplay, setCompanionDisplay] = useState<CompanionDisplayMode | 'hidden'>('hidden');
  const [selectedPersona, setSelectedPersona] = useState<Persona>('mom');
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [companionKey, setCompanionKey] = useState(0);
  const companionActive = companionDisplay !== 'hidden';
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [emergencyTrigger, setEmergencyTrigger] = useState<'sos' | 'shake'>('shake');
  const lastSmsLocRef = useRef<LatLng | null>(null);

  const [guardianPhones, setGuardianPhones] = useState<[string, string]>(loadGuardianPhones);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [walkStarted, setWalkStarted] = useState(false);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'onRoute' | 'offRoute'>('idle');
  const [sharePrompt, setSharePrompt] = useState<{ message: string; createdAt: number } | null>(null);
  const lastSharePromptRef = useRef<number>(0);
  const kakaoSearchKeyRef = useRef('');

  // Kakao Maps SDK init
  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    const MAX = 150;
    const timer = setInterval(() => {
      attempts++;
      const w = window as any;
      if (w.kakao?.maps?.Map) {
        clearInterval(timer);
        if (!stopped) setKakaoReady(true);
        return;
      }
      if (attempts >= MAX) {
        clearInterval(timer);
        if (!stopped) {
          const st = `kakao=${typeof (window as any).kakao}, maps=${typeof (window as any).kakao?.maps}`;
          setKakaoError(
            `Kakao 지도 SDK 로드 실패 (15초 초과)\n상태: ${st}\n\n` +
            'Kakao 개발자 콘솔 > 내 앱 > JavaScript 키 수정\n' +
            'JavaScript SDK 도메인에 http://localhost:5173 추가 후 저장'
          );
        }
      }
    }, 100);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  // userLocation ?gpsOrigin ?숆린?(泥?GPS ?뺤젙 ?吏?以묒떖??대룞)
  useEffect(() => {
    if (userLocation) {
      const loc: LatLng = { lat: userLocation.lat, lng: userLocation.lng };
      setGpsOrigin(loc);
      if (walkStarted) setUserPos(loc);
      // 吏?以묒떖??꾩쭅 媛뺣쫱 湲곕낯媛믪씠硫?泥?GPS 醫뚰몴濡?ㅻ깄
      setUserPos((prev) =>
        prev.lat === GANGNEUNG_CENTER.lat && prev.lng === GANGNEUNG_CENTER.lng ? loc : prev
      );
    } else if (locationReady && !userLocation) {
      // GPS 沅뚰븳 嫄곕? ??ㅽ뙣 ?媛뺣쫱 ?쇳꽣 ?대갚
      setGpsOrigin(GANGNEUNG_CENTER);
    }
  }, [userLocation, locationReady, walkStarted]);

  // CCTV + 媛濡쒕벑 ?곗씠?濡쒕뱶
  useEffect(() => {
    const routeNeeds = (id: SafetyFeatureId) => safetySettings.safeRouteEnabled && safetySettings.selectedFeatures.includes(id);
    if ((visibleFeatures.cctv || routeNeeds('cctv')) && cctvList === GANGNEUNG_CCTV_FALLBACK) loadCctvData().then(setCctvList);
    if ((visibleFeatures.light || routeNeeds('light')) && streetlightData.length === 0) loadStreetlightData().then(setStreetlightData);
    if ((visibleFeatures.food || routeNeeds('food')) && gyodongFoodPoints.length === 0) loadGyodongFoodSafetyPoints().then(setGyodongFoodPoints);
    if ((visibleFeatures.police || visibleFeatures.fire || visibleFeatures.toilet || routeNeeds('police') || routeNeeds('fire') || routeNeeds('toilet')) && lifeSafetyPoints.length === 0) fetchLifeSafetyPoints().then(setLifeSafetyPoints);
    if ((visibleFeatures.childSafeHouse || routeNeeds('childSafeHouse')) && childSafeHouses.length === 0) fetchChildSafeHouses()
      .then((items) => {
        setChildSafeHouses(items);
        if (items.length === 0) setChildSafeHouseError('\uAC15\uB989\uC2DC \uC548\uC804\uC9C0\uD0B4\uC774\uC9D1 \uB370\uC774\uD130\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');
      })
      .catch(() => setChildSafeHouseError('\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.'));
  }, [visibleFeatures, safetySettings.safeRouteEnabled, safetySettings.selectedFeatures, cctvList, streetlightData.length, gyodongFoodPoints.length, lifeSafetyPoints.length, childSafeHouses.length]);

  // SOS ?몃━嫄?⑥닔
  const triggerSOSByButton = useCallback(() => {
    setEmergencyTrigger('sos');
    setEmergencyActive(true);
  }, []);

  const triggerSOSByShake = useCallback(() => {
    setEmergencyTrigger('shake');
    setEmergencyActive(true);
  }, []);

  // ?몃뱶??멸쾶 2踰?붾뱾湲?媛먯? ?SOS
  useShakeDetection(triggerSOSByShake, true);

  // ?숉뻾 以?500m留덈떎 蹂댄샇?SMS
  useEffect(() => {
    if (!companionActive || !gpsOrigin) return;
    const valid = guardianPhones.filter(p => p.trim());
    if (valid.length === 0) return;
    if (!lastSmsLocRef.current) {
      lastSmsLocRef.current = gpsOrigin;
      return;
    }
    const dist = distanceMeters(gpsOrigin, lastSmsLocRef.current);
    if (dist >= 500) {
      lastSmsLocRef.current = gpsOrigin;
      sendGuardianSMSAll(valid, buildGuardianMessage('location_update', gpsOrigin, destination?.name));
    }
  }, [gpsOrigin, companionActive, guardianPhones, destination]);

  // Reset SMS location when companion mode stops
  useEffect(() => {
    if (!companionActive) lastSmsLocRef.current = null;
  }, [companionActive]);

  const saveSettings = (settings: SafetySettings, phones: [string, string]) => {
    setSafetySettings(settings);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    setGuardianPhones(phones);
    localStorage.setItem(GUARDIAN_STORAGE_KEY, JSON.stringify(phones));
    setShowSettingsModal(false);
  };

  const toggleVisibleFeature = (id: SafetyFeatureId) => {
    startTransition(() => {
      setVisibleFeatures((current) => ({ ...current, [id]: !current[id] }));
    });
  };

  const handleOriginSelect = useCallback((place: Place) => {
    setManualOrigin(place);
    setUserPos(place.position);
  }, []);

  const handleOriginReset = useCallback(() => {
    setManualOrigin(null);
    if (gpsOrigin) setUserPos(gpsOrigin);
  }, [gpsOrigin]);

  const childSafeHousePoints = useMemo(
    () => childSafeHousesToSafetyPoints(childSafeHouses),
    [childSafeHouses]
  );

  useEffect(() => {
    if (!showOverlays || !mapBounds) {
      setViewportSafeSpots([]);
      return;
    }
    const kakaoFeatureIds = SAFETY_FEATURES
      .map((feature) => feature.id)
      .filter((id) => visibleFeatures[id])
      .filter((id) => id === 'convenience' || id === 'food' || id === 'police' || id === 'fire' || id === 'medical');

    if (kakaoFeatureIds.length === 0) {
      setViewportSafeSpots([]);
      kakaoSearchKeyRef.current = '';
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const featureKey = kakaoFeatureIds.join(',');
      const boundsKey = [
        mapBounds.sw.lat,
        mapBounds.sw.lng,
        mapBounds.ne.lat,
        mapBounds.ne.lng,
      ].map((value) => value.toFixed(3)).join(',');
      const requestKey = `${featureKey}:${boundsKey}`;
      if (kakaoSearchKeyRef.current === requestKey) return;
      kakaoSearchKeyRef.current = requestKey;

      fetchSafeSpotsInBounds(mapBounds, kakaoFeatureIds)
        .then((items) => {
          if (!cancelled) setViewportSafeSpots(items);
        })
        .catch(() => {
          if (!cancelled) setViewportSafeSpots([]);
        });
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mapBounds, showOverlays, visibleFeatures]);

  const handleDestinationSelect = useCallback(
    async (place: Place) => {
      if (!effectiveOrigin) return;
      setDestination(place);
      setError(null);
      setLoading(true);
      setStep('routes');
      try {
        const center = {
          lat: (effectiveOrigin.lat + place.position.lat) / 2,
          lng: (effectiveOrigin.lng + place.position.lng) / 2,
        };
        const spots = await fetchSafeSpots(center, 1500);
        setSafeSpots(spots);
        const nextAllPoints = mergeSafetyPoints([
          ...cctvToSafetyPoints(cctvList),
          ...streetlightsToSafetyPoints(streetlightData),
          ...kakaoSafeSpotsToSafetyPoints(spots),
          ...kakaoSafeSpotsToSafetyPoints(viewportSafeSpots),
          ...gyodongFoodPoints,
          ...lifeSafetyPoints,
          ...childSafeHousePoints,
        ]);
        const enabledForRoute = safetySettings.safeRouteEnabled && safetySettings.selectedFeatures.length > 0;
        const fast = await fetchFastPedestrianRoute(effectiveOrigin, place.position);
        setFastRoute(fast);
        if (enabledForRoute) {
          const routePoints = nextAllPoints.filter((point) => safetySettings.selectedFeatures.includes(point.featureId));
          const routes = await fetchSelectedPedestrianRoutes(effectiveOrigin, place.position, routePoints, safetySettings.selectedFeatures, fast);
          const { safeRoute: sr } = pickBestRoute(routes);
          setSafeRoute(sr);
          setActiveRoute('safe');
        } else {
          setSafeRoute(null);
          setActiveRoute('fast');
        }
        setLockedOrigin(effectiveOrigin);
        setWalkStarted(false);
        setRouteStatus('idle');
        setSharePrompt(null);
        setRoutesPanelCollapsed(false);
        lastSharePromptRef.current = 0;
      } catch (e) {
        console.error(e);
        setError('경로를 불러오지 못했습니다. API 키 또는 네트워크를 확인해 주세요.');
      } finally {
        setLoading(false);
      }
    },
    [effectiveOrigin, cctvList, streetlightData, viewportSafeSpots, gyodongFoodPoints, lifeSafetyPoints, childSafeHousePoints, safetySettings]
  );

  const handleStartWalk = () => {
    setWalkStarted(true);
    setSharePrompt(null);
    lastSharePromptRef.current = Date.now();
    if (userLocation) setUserPos({ lat: userLocation.lat, lng: userLocation.lng });
  };

  const handleShareLocation = () => {
    const valid = guardianPhones.filter((phone) => phone.trim());
    if (!sharePrompt || valid.length === 0) return;
    sendGuardianSMSAll(valid, sharePrompt.message);
    setSharePrompt(null);
  };

  const handleMapClick = useCallback((pos: { lat: number; lng: number }, address: string) => {
    setMapClickInfo({ ...pos, address });
    setRoutesPanelCollapsed(true);
  }, []);

  const handleSetOriginFromMap = useCallback(() => {
    if (!mapClickInfo) return;
    const place: Place = {
      name: mapClickInfo.address,
      address: mapClickInfo.address,
      position: { lat: mapClickInfo.lat, lng: mapClickInfo.lng },
    };
    handleOriginSelect(place);
    setMapClickInfo(null);
  }, [mapClickInfo, handleOriginSelect]);

  const handleSetDestFromMap = useCallback(() => {
    if (!mapClickInfo) return;
    const place: Place = {
      name: mapClickInfo.address,
      address: mapClickInfo.address,
      position: { lat: mapClickInfo.lat, lng: mapClickInfo.lng },
    };
    setMapClickInfo(null);
    handleDestinationSelect(place);
  }, [mapClickInfo, handleDestinationSelect]);

  const activeNodes = useMemo(() => {
    const route = activeRoute === 'safe' ? safeRoute : fastRoute;
    return route?.nodes ?? [];
  }, [safeRoute, fastRoute, activeRoute]);

  const hasVisibleFeature = useMemo(
    () => Object.values(visibleFeatures).some(Boolean),
    [visibleFeatures]
  );

  const routeCandidateSafetyPoints = useMemo(() => mergeSafetyPoints([
    ...cctvToSafetyPoints(cctvList),
    ...streetlightsToSafetyPoints(streetlightData),
    ...kakaoSafeSpotsToSafetyPoints(safeSpots),
    ...kakaoSafeSpotsToSafetyPoints(viewportSafeSpots),
    ...gyodongFoodPoints,
    ...lifeSafetyPoints,
    ...childSafeHousePoints,
  ]), [cctvList, streetlightData, safeSpots, viewportSafeSpots, gyodongFoodPoints, lifeSafetyPoints, childSafeHousePoints]);

  const routeEvidenceSafetyPoints = useMemo((): SafetyPoint[] => {
    if (activeRoute !== 'safe' || !safeRoute || !safetySettings.selectedFeatures.length) return EMPTY_SAFETY_POINTS;
    return collectSelectedRouteSafetyPoints(
      safeRoute.nodes,
      routeCandidateSafetyPoints,
      safetySettings.selectedFeatures
    );
  }, [activeRoute, safeRoute, routeCandidateSafetyPoints, safetySettings.selectedFeatures]);

  const visibleRouteEvidenceSafetyPoints = useMemo((): SafetyPoint[] => {
    if (!hasVisibleFeature) return EMPTY_SAFETY_POINTS;
    return routeEvidenceSafetyPoints.filter((point) => visibleFeatures[point.featureId]);
  }, [hasVisibleFeature, routeEvidenceSafetyPoints, visibleFeatures]);

  const displaySafetyPoints = useMemo((): SafetyPoint[] => {
    if (!showOverlays || !hasVisibleFeature) return EMPTY_SAFETY_POINTS;
    const capByFeature: Partial<Record<SafetyFeatureId, number>> = {
      cctv: 180,
      light: 1200,
      food: 180,
      convenience: 120,
      childSafeHouse: 100,
      police: 120,
      fire: 80,
      medical: 80,
      toilet: 120,
    };
    const inCurrentBounds = (point: LatLng) => {
      if (!mapBounds) return true;
      return point.lat >= mapBounds.sw.lat
        && point.lat <= mapBounds.ne.lat
        && point.lng >= mapBounds.sw.lng
        && point.lng <= mapBounds.ne.lng;
    };
    const takeVisible = <T extends LatLng>(
      items: T[],
      featureId: SafetyFeatureId,
      mapItem: (item: T, index: number) => SafetyPoint
    ) => {
      if (!visibleFeatures[featureId]) return [];
      const cap = capByFeature[featureId] ?? 500;
      const selected: SafetyPoint[] = [];
      for (let index = 0; index < items.length && selected.length < cap; index += 1) {
        const item = items[index];
        if (!inCurrentBounds(item)) continue;
        selected.push(mapItem(item, index));
      }
      return selected;
    };
    const takeSafetyPoints = (items: SafetyPoint[], featureId: SafetyFeatureId) => {
      if (!visibleFeatures[featureId]) return [];
      const cap = capByFeature[featureId] ?? 500;
      const selected: SafetyPoint[] = [];
      for (const point of items) {
        if (selected.length >= cap) break;
        if (point.featureId !== featureId || !inCurrentBounds(point)) continue;
        if (!isSafetyPointAvailable(point)) continue;
        selected.push(point);
      }
      return selected;
    };
    const cctvConfig = getSafetyFeature('cctv');
    const lightConfig = getSafetyFeature('light');
    const kakaoDisplayPoints = kakaoSafeSpotsToSafetyPoints([...safeSpots, ...viewportSafeSpots]);
    const selected = [
      ...takeVisible(cctvList, 'cctv', (point, index) => ({
        id: `cctv:${point.lat.toFixed(6)},${point.lng.toFixed(6)}:${index}`,
        name: point.name ?? 'CCTV',
        lat: point.lat,
        lng: point.lng,
        featureId: 'cctv',
        category: cctvConfig.label,
        source: point.source ?? 'Gangneung CCTV',
        weight: cctvConfig.weight,
        nightWeight: cctvConfig.nightWeight,
      })),
      ...takeVisible(streetlightData, 'light', (point, index) => ({
        id: `light:${point.lat.toFixed(6)},${point.lng.toFixed(6)}:${index}`,
        name: point.name ?? lightConfig.label,
        lat: point.lat,
        lng: point.lng,
        featureId: 'light',
        category: lightConfig.label,
        source: point.source ?? 'Gangneung streetlight',
        weight: lightConfig.weight,
        nightWeight: lightConfig.nightWeight,
      })),
      ...takeSafetyPoints(kakaoDisplayPoints, 'convenience'),
      ...takeSafetyPoints(kakaoDisplayPoints, 'food'),
      ...takeSafetyPoints(kakaoDisplayPoints, 'police'),
      ...takeSafetyPoints(kakaoDisplayPoints, 'fire'),
      ...takeSafetyPoints(kakaoDisplayPoints, 'medical'),
      ...takeSafetyPoints(gyodongFoodPoints, 'food'),
      ...takeSafetyPoints(lifeSafetyPoints, 'police'),
      ...takeSafetyPoints(lifeSafetyPoints, 'fire'),
      ...takeSafetyPoints(lifeSafetyPoints, 'toilet'),
      ...takeSafetyPoints(childSafeHousePoints, 'childSafeHouse'),
    ];
    return mergeSafetyPoints(selected);
  }, [
    cctvList,
    streetlightData,
    safeSpots,
    viewportSafeSpots,
    gyodongFoodPoints,
    lifeSafetyPoints,
    childSafeHousePoints,
    hasVisibleFeature,
    mapBounds,
    showOverlays,
    visibleFeatures,
  ]);

  useEffect(() => {
    if (!walkStarted || !userLocation || activeNodes.length === 0) {
      if (!walkStarted) setRouteStatus('idle');
      return;
    }
    const dist = minDistToRoute(userLocation, activeNodes);
    setRouteStatus(dist > 50 ? 'offRoute' : 'onRoute');
  }, [walkStarted, userLocation, activeNodes]);

  useEffect(() => {
    if (!walkStarted || !userLocation || activeNodes.length === 0) return;
    const valid = guardianPhones.filter((phone) => phone.trim());
    if (valid.length === 0) return;
    const now = Date.now();
    const intervalMs = safetySettings.shareIntervalMinutes * 60 * 1000;
    if (lastSharePromptRef.current && now - lastSharePromptRef.current < intervalMs) return;

    const dist = minDistToRoute(userLocation, activeNodes);
    const statusText = dist > 50
      ? `경로를 벗어났습니다. 경로에서 약 ${Math.round(dist)}m 떨어졌습니다.`
      : '경로를 따라 이동 중입니다.';
    const mapsLink = `https://maps.google.com/?q=${userLocation.lat.toFixed(5)},${userLocation.lng.toFixed(5)}`;
    const routeName = activeRoute === 'safe' ? '안심길' : '빠른길';
    const message = `[ON:길 위치공유]\n${routeName} 이동 중\n${destination ? `목적지: ${destination.name}\n` : ""}상태: ${statusText}\n현재 위치: ${mapsLink}`;
    lastSharePromptRef.current = now;
    setSharePrompt({ message, createdAt: now });
  }, [walkStarted, userLocation, activeNodes, guardianPhones, safetySettings.shareIntervalMinutes, activeRoute, destination]);

  const activePanelRoute = activeRoute === 'safe' ? safeRoute : fastRoute;
  const canShowRoutePanel = step === 'routes' && !loading && companionDisplay === 'hidden';

  // SDK 오류 화면
  if (kakaoError) {
    return (
      <div style={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif", background: '#F8FAFC', boxSizing: 'border-box' }}>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#1E3A5F', marginBottom: '16px' }}>ON:吉 온길</div>
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '16px', padding: '20px 24px', maxWidth: '360px', width: '100%' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#DC2626', marginBottom: '12px' }}>지도 SDK 초기화 실패</div>
          <pre style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.7 }}>{kakaoError}</pre>
        </div>
      </div>
    );
  }

  // SDK 로딩 중 화면
  if (!kakaoReady) {
    return (
      <div style={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif", background: '#F8FAFC' }}>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#1E3A5F' }}>ON:吉 온길</div>
        <div style={{ width: '36px', height: '36px', border: '3px solid #E5E7EB', borderTop: '3px solid #3B82F6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ fontSize: '13px', color: '#94A3B8' }}>지도를 불러오는 중...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif", background: '#F8FAFC', position: 'relative', overflow: 'hidden' }}>

      {/* 헤더 */}
      <div style={{ background: '#fff', padding: '10px 12px 8px', borderBottom: '1px solid #F1F5F9', zIndex: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#1E3A5F' }}>ON:吉 온길</div>
            <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '1px' }}>강릉 야간 안심 이동 서비스</div>
          </div>
          <button
            onClick={() => setShowSettingsModal(true)}
            style={{
              marginLeft: 'auto',
              fontSize: '12px',
              padding: '7px 12px',
              borderRadius: '999px',
              border: '1px solid rgba(30,58,95,0.12)',
              background: 'linear-gradient(135deg, #1E3A5F, #2563EB)',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 900,
              boxShadow: '0 8px 18px rgba(37,99,235,0.24)',
              lineHeight: 1,
            }}
          >
            설정
          </button>
        </div>

        {!locationReady ? (
          <div style={{ textAlign: 'center', padding: '10px', color: '#94A3B8', fontSize: '13px' }}>위치 확인 중...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* 출발吏 ?*/}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: 600, minWidth: '26px' }}>출발</span>
              <div style={{ flex: 1 }}>
                <SearchBar
                  key={`origin-${step}-${Boolean(manualOrigin)}`}
                  onSelect={handleOriginSelect}
                  placeholder={manualOrigin ? manualOrigin.name : '현재 위치 (GPS)'}
                  defaultValue={manualOrigin?.name ?? ''}
                  userPosition={gpsOrigin}
                />
              </div>
              {manualOrigin && (
                <button
                  onClick={handleOriginReset}
                  title="현재 위치로 초기화"
                  style={{ padding: '7px 8px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                >
                  GPS
                </button>
              )}
            </div>
            {/* 紐⑹쟻吏 ?*/}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: 600, minWidth: '26px' }}>도착</span>
              <div style={{ flex: 1 }}>
                <SearchBar
                  key={`dest-${step}`}
                  onSelect={handleDestinationSelect}
                  placeholder="어디로 갈까요?"
                  defaultValue={destination?.name ?? ''}
                  userPosition={gpsOrigin}
                />
              </div>
            </div>
          </div>
        )}

        {showOverlays && (
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingTop: '8px', paddingBottom: 1 }}>
            {SAFETY_FEATURES.map((feature) => {
              const active = visibleFeatures[feature.id];
              return (
                <button
                  key={feature.id}
                  onClick={() => toggleVisibleFeature(feature.id)}
                  style={{
                    flex: '0 0 auto',
                    border: 0,
                    background: 'transparent',
                    color: active ? '#111827' : '#64748B',
                    padding: '2px 0',
                    fontSize: '11px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <SafetyMarkerBadge feature={feature} active={active} size={28} />
                  <span>{feature.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 湲닿툒?좉퀬 ?붾㈃ (理쒖슦??ㅻ쾭?덉씠) */}
      {emergencyActive && (
        <EmergencyScreen
          guardianPhones={guardianPhones}
          currentLocation={gpsOrigin}
          trigger={emergencyTrigger}
          onClose={() => setEmergencyActive(false)}
        />
      )}


      {showSettingsModal && (
        <SettingsModal
          initialSettings={safetySettings}
          initialPhones={guardianPhones}
          onSave={saveSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {/* 吏??곸뿭 */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <KakaoMap
          center={userPos}
          origin={lockedOrigin ?? manualOrigin?.position ?? null}
          destination={destination?.position ?? null}
          safeRoute={safeRoute}
          fastRoute={fastRoute}
          activeRoute={activeRoute}
          cctvList={[]}
          safeSpots={[]}
          streetlights={[]}
          childSafeHouses={[]}
          safetyPoints={displaySafetyPoints}
          routeEvidencePoints={visibleRouteEvidenceSafetyPoints}
          safemapWmsLayers={EMPTY_WMS_LAYERS}
          showOverlays={showOverlays}
          onMapClick={handleMapClick}
          onBoundsChange={setMapBounds}
          userLocation={userLocation}
          crimeWmsKey={CRIME_WMS_KEY}
          showCrimeOverlay={showOverlays && hasVisibleFeature}
        />

        {childSafeHouseError && (
          <div style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            zIndex: 30,
            background: '#FFF7ED',
            border: '1px solid #FDBA74',
            borderRadius: '12px',
            padding: '10px 12px',
            color: '#9A3412',
            fontSize: '12px',
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            {childSafeHouseError}
          </div>
        )}

        {/* 吏??대┃ ?출발吏/도착吏 ?ㅼ젙 諛뷀?쒗듃 */}
        {sharePrompt && (
          <div style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            zIndex: 32,
            background: '#ECFDF5',
            border: '1px solid #86EFAC',
            borderRadius: '12px',
            padding: '12px',
            boxShadow: '0 6px 18px rgba(15,23,42,0.16)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#047857' }}>보호자에게 위치 공유 시간이 됐습니다</div>
                <div style={{ fontSize: 11, color: '#059669', marginTop: 3 }}>
                  {routeStatus === 'offRoute' ? '경로 이탈 상태가 함께 전달돼요.' : '경로를 따라 이동 중인 상태가 함께 전달돼요.'}
                </div>
              </div>
              <button
                onClick={handleShareLocation}
                style={{ border: 0, background: '#059669', color: '#fff', borderRadius: 10, padding: '9px 11px', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}
              >
                문자 보내기
              </button>
              <button
                onClick={() => setSharePrompt(null)}
                style={{ border: 0, background: '#D1FAE5', color: '#047857', borderRadius: 10, width: 32, height: 32, fontSize: 18, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {mapClickInfo && !loading && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
            background: '#fff', borderRadius: '16px 16px 0 0',
            padding: '12px 12px 18px',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
            fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '3px' }}>선택한 위치</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', lineHeight: 1.35 }}>{mapClickInfo.address}</div>
              </div>
              <button
                onClick={() => {
                  setMapClickInfo(null);
                  setRoutesPanelCollapsed(false);
                }}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9CA3AF', padding: '2px 4px', lineHeight: 1 }}
              >
                x
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSetOriginFromMap}
                style={{
                  flex: 1, padding: '12px 8px', borderRadius: '14px',
                  background: 'linear-gradient(180deg, #3D63F1 0%, #6FB9D8 100%)',
                  color: '#fff',
                  border: 'none',
                  fontSize: '15px', fontWeight: 900, cursor: 'pointer',
                  boxShadow: '0 8px 18px rgba(56,102,242,0.25)',
                  fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                <WhitePinIcon accent="#3D63F1" />
                출발지로 설정
              </button>
              <button
                onClick={handleSetDestFromMap}
                style={{
                  flex: 1, padding: '12px 8px', borderRadius: '14px',
                  background: 'linear-gradient(180deg, #D64F77 0%, #DD7168 100%)',
                  color: '#fff',
                  border: 'none',
                  fontSize: '15px', fontWeight: 900, cursor: 'pointer',
                  boxShadow: '0 8px 18px rgba(242,51,127,0.25)',
                  fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                <WhitePinIcon accent="#D64F77" />
                도착지로 설정
              </button>
            </div>
          </div>
        )}

        {/* SOS 踰꾪듉 (吏?醫뚰븯*/}
        <div style={{
          position: 'absolute', bottom: '20px', left: '16px', zIndex: 25,
        }}>
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', inset: '-8px', borderRadius: '50%',
              border: '2px solid rgba(220,38,38,0.5)',
              animation: 'sos-pulse 2s ease-out infinite',
            }} />
            <button
              onClick={triggerSOSByButton}
              style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #DC2626, #7F1D1D)',
                border: 'none', color: '#fff',
                fontSize: '20px', fontWeight: 900, letterSpacing: '1px',
                cursor: 'pointer',
                boxShadow: '0 4px 24px rgba(220,38,38,0.7)',
                position: 'relative', zIndex: 1,
                fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
              }}
            >
              SOS
            </button>
          </div>
        </div>

        {/* AI ?숉뻾 ?쒖옉 踰꾪듉 (吏??고븯*/}
        {!loading && !companionActive && (
          <button
            onClick={() => setShowPersonaModal(true)}
            style={{
              position: 'absolute', bottom: '20px', right: '16px', zIndex: 15,
              background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              color: '#fff', border: 'none', borderRadius: '24px',
              padding: '12px 18px', fontSize: '14px', fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(124,58,237,0.5)',
              display: 'flex', alignItems: 'center', gap: '6px',
              fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
            }}
          >
            AI 음성 대화
          </button>
        )}

        {canShowRoutePanel && routesPanelCollapsed && (safeRoute || fastRoute || error) && !mapClickInfo && (
          <button
            onClick={() => setRoutesPanelCollapsed(false)}
            style={{
              position: 'absolute',
              right: 16,
              bottom: 90,
              zIndex: 24,
              border: 'none',
              borderRadius: 999,
              background: '#111827',
              color: '#fff',
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              boxShadow: '0 8px 22px rgba(15,23,42,0.26)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
            }}
          >
            <span>경로 보기</span>
            {activePanelRoute && (
              <span style={{ color: '#BFDBFE', fontWeight: 800 }}>
                {activeRoute === 'safe' ? '안심길' : '빠른길'} {formatRouteTime(activePanelRoute.totalTime)}
              </span>
            )}
          </button>
        )}

        {/* ?섎Ⅴ?뚮굹 ?좏깮 紐⑤떖 */}
        {showPersonaModal && (
          <div
            onClick={() => setShowPersonaModal(false)}
            style={{
              position: 'absolute', inset: 0, zIndex: 50,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#fff', borderRadius: '20px', padding: '28px 24px',
                width: '300px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
              }}
            >
              <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '16px', margin: '0 0 8px' }}>
                누구와 통화할까요?
              </p>
              <p style={{ textAlign: 'center', fontSize: '12px', color: '#9CA3AF', margin: '0 0 24px' }}>
                선택한 페르소나와 한국어로 자연스럽게 대화해요.
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                {(['mom', 'dad', 'brother'] as Persona[]).map(p => {
                  const selected = selectedPersona === p;
                  return (
                    <button
                      key={p}
                      onClick={() => setSelectedPersona(p)}
                      style={{
                        flex: 1, padding: '16px 8px', borderRadius: '14px',
                        border: selected ? '2px solid #7c3aed' : '2px solid #E5E7EB',
                        background: selected ? '#F5F3FF' : '#fff',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: '6px',
                      }}
                    >
                      <span style={{ fontSize: '28px' }}>{PERSONA_EMOJI[p]}</span>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: selected ? '#7c3aed' : '#374151' }}>
                        {PERSONA_LABELS[p]}
                      </span>
                      <span style={{ fontSize: '10px', color: '#9CA3AF', lineHeight: 1.35 }}>
                        {PERSONA_DESCRIPTIONS[p]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  setShowPersonaModal(false);
                  setCompanionKey(k => k + 1);
                  setCompanionDisplay('fullscreen');
                }}
                style={{
                  marginTop: '20px', width: '100%', padding: '14px',
                  background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                  color: '#fff', border: 'none', borderRadius: '12px',
                  fontSize: '15px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {PERSONA_LABELS[selectedPersona]}와 통화하기
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', zIndex: 12 }}>
            <div style={{ width: '36px', height: '36px', border: '3px solid #E5E7EB', borderTop: '3px solid #3B82F6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: '14px', color: '#374151', fontWeight: 600 }}>안전 경로 분석 중...</div>
          </div>
        )}
      </div>

      {/* AI ?뚯꽦 ??*/}
      {companionDisplay !== 'hidden' && (
        <CompanionCall
          key={companionKey}
          persona={selectedPersona}
          displayMode={companionDisplay}
          onDisplayModeChange={setCompanionDisplay}
          onEnd={() => setCompanionDisplay('hidden')}
        />
      )}

      {/* 寃쎈줈 移대뱶 ?⑤꼸 ??숉뻾 以묒뿉??④? */}
      {canShowRoutePanel && !routesPanelCollapsed && (
        <div style={{ background: '#fff', padding: '10px 12px 12px', borderTop: '1px solid #F1F5F9', flexShrink: 0, boxShadow: '0 -4px 20px rgba(0,0,0,0.06)' }}>
          {error ? (
            <div style={{ textAlign: 'center', padding: '12px', color: '#EF4444', fontSize: '13px', background: '#FEF2F2', borderRadius: '12px' }}>{error}</div>
          ) : (safeRoute || fastRoute) ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '8px' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#6B7280', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {destination?.name}까지의 경로
                </div>
                <button
                  onClick={() => setRoutesPanelCollapsed(true)}
                  style={{
                    border: '1px solid #E5E7EB',
                    background: '#F8FAFC',
                    color: '#475569',
                    borderRadius: 999,
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  접기
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', minWidth: 0, alignItems: 'stretch' }}>
                {safeRoute && (
                  <RouteCard
                    type="safe"
                    route={safeRoute}
                    selectedFeatureIds={safetySettings.selectedFeatures}
                    active={activeRoute === 'safe'}
                    onClick={() => {
                      setActiveRoute('safe');
                      setWalkStarted(false);
                      setRouteStatus('idle');
                    }}
                  />
                )}
                {fastRoute && (
                  <RouteCard
                    type="fast"
                    route={fastRoute}
                    active={activeRoute === 'fast'}
                    onClick={() => {
                      setActiveRoute('fast');
                      setWalkStarted(false);
                      setRouteStatus('idle');
                    }}
                  />
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
                <button
                  onClick={handleStartWalk}
                  disabled={walkStarted}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: '10px',
                    border: 'none',
                    background: walkStarted ? '#E2E8F0' : '#1E3A5F',
                    color: walkStarted ? '#64748B' : '#fff',
                    fontWeight: 900,
                    cursor: walkStarted ? 'default' : 'pointer',
                  }}
                >
                  {walkStarted ? '이동 추적 중' : '이동 시작'}
                </button>
                {walkStarted && (
                  <div style={{ minWidth: 104, textAlign: 'center', fontSize: '11px', fontWeight: 900, color: routeStatus === 'offRoute' ? '#DC2626' : '#059669' }}>
                    {routeStatus === 'offRoute' ? '경로 이탈' : '경로 따라 이동'}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes sos-pulse {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        body { margin: 0; padding: 0; }
      `}</style>
    </div>
  );
}

function WhitePinIcon({ accent }: { accent: string }) {
  return (
    <svg width="22" height="28" viewBox="0 0 24 32" fill="none" style={{ display: 'block', flex: '0 0 auto' }}>
      <path d="M12 31s10-10.1 10-19A10 10 0 1 0 2 12c0 8.9 10 19 10 19z" fill="#fff" />
      <circle cx="12" cy="12" r="4.2" fill={accent} />
    </svg>
  );
}

function SafetyFeatureIcon({ id, size = 20 }: { id: SafetyFeatureId; size?: number }) {
  const stroke = 'currentColor';
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 2.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (id === 'cctv') {
    return <svg {...common}><path d="M4 11a8 8 0 0 1 16 0v3H4z" /><path d="M7 14v3h10v-3" /><circle cx="12" cy="13" r="2.2" /><path d="M12 17v3" /><path d="M9 20h6" /></svg>;
  }
  if (id === 'food') {
    return <svg {...common}><path d="M7 3v8" /><path d="M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3" /><path d="M7 11v10" /><path d="M16 3c2 1.8 3 4 3 6.5 0 2-1.1 3.5-3 3.5h-1V3z" /><path d="M16 13v8" /><path d="M11.5 5.5h2.5" /></svg>;
  }
  if (id === 'convenience') {
    return <svg {...common}><path d="M4 9h16v11H4z" /><path d="M7 20v-6h10v6" /><path d="M9 20v-6" /><path d="M15 20v-6" /><path d="M8 6h8l2 3H6z" /><text x="12" y="13" textAnchor="middle" fontSize="6.2" fill="currentColor" stroke="none" fontWeight="900">24</text></svg>;
  }
  if (id === 'police') {
    return <svg {...common}><path d="M12 3l7 3v5c0 4.5-3 7.8-7 10-4-2.2-7-5.5-7-10V6l7-3z" /><path d="M8.5 10.5l2.4 2.4 4.8-5" /><text x="12" y="18" textAnchor="middle" fontSize="5.2" fill="currentColor" stroke="none" fontWeight="900">112</text></svg>;
  }
  if (id === 'fire') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><text x="12" y="13.5" textAnchor="middle" fontSize="10" fill="currentColor" fontWeight="900" fontStyle="italic">119</text><path d="M5.5 17.2h4.5M11.2 17.2h4.5M16.6 17.2h2.4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /><path d="M4.8 20h4.3M10.5 20h4.3M16 20h3.2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>;
  }
  if (id === 'light') {
    return <svg {...common}><path d="M8 21h7" /><path d="M9.5 18h4" /><path d="M10 18V7a4 4 0 0 1 8 0v3" /><path d="M17 10h3" /><path d="M14.5 13h7" /><path d="M15.5 13a3 3 0 0 1 5 0" /><path d="M18 13v2.5" /><path d="M15.5 17l-2 2" /><path d="M20.5 17l2 2" /></svg>;
  }
  if (id === 'childSafeHouse') {
    return <svg {...common}><path d="M4 11.5L12 4l8 7.5" /><path d="M6.5 10.5V20h11v-9.5" /><path d="M10 20v-5h4v5" /><path d="M9 11.5h6" /></svg>;
  }
  if (id === 'medical') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></svg>;
  }
  if (id === 'toilet') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="8" r="1.5" fill="#fff" /><circle cx="16" cy="8" r="1.5" fill="#fff" /><path d="M7 11h2l1 6H6z" fill="#fff" /><path d="M15 11h2l1 6h-4z" fill="#fff" /><path d="M12 6v12" stroke="#fff" strokeWidth="1.3" /></svg>;
  }
  return <svg {...common}><path d="M12 4v10" /><path d="M12 18h.01" /><path d="M6 8a6 6 0 0 1 12 0" /></svg>;
}

function SafetyMarkerBadge({ feature, active, size = 36 }: { feature: SafetyFeatureConfig; active: boolean; size?: number }) {
  if (feature.iconFile) {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          background: active ? feature.color : '#D1D5DB',
          border: '3px solid #fff',
          boxShadow: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <img
          src={`/icons/${feature.iconFile}`}
          width={size}
          height={size}
          style={{
            display: 'block',
            width: size,
            height: size,
            objectFit: 'cover',
            filter: active ? 'none' : 'grayscale(1)',
            opacity: active ? 1 : 0.45,
          }}
          alt=""
        />
      </span>
    );
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: active ? feature.color : '#D1D5DB',
        border: '3px solid #fff',
        boxShadow: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <SafetyFeatureIcon id={feature.id} size={Math.round(size * 0.72)} />
      </span>
    </span>
  );
}
