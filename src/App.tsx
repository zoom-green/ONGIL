import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import KakaoMap from './components/KakaoMap';
import SearchBar from './components/SearchBar';
import RouteCard from './components/RouteCard';
import CompanionCall from './components/CompanionCall';
import type { CompanionDisplayMode } from './components/CompanionCall';
import EmergencyScreen from './components/EmergencyScreen';
import { useUserLocation } from './hooks/useUserLocation';
import type { LatLng, Place, RouteCandidate, CctvPoint, SafeSpot, StreetlightPoint, ChildSafeHousePoint } from './types';
import { CHILD_SAFE_HOUSES } from './data/childSafeHouses';
import { fetchPedestrianRoutes } from './utils/tmap';
import { loadCctvData } from './utils/cctv';
import { loadStreetlightData } from './utils/streetlight';
import { fetchSafeSpots } from './utils/kakaoLocal';
import { pickBestRoute, distanceMeters } from './utils/safety';
import { GANGNEUNG_CCTV_FALLBACK } from './data/cctvFallback';
import { useShakeDetection } from './hooks/useShakeDetection';
import { sendGuardianSMSAll, buildGuardianMessage } from './utils/sms';
import GuardianModal from './components/GuardianModal';
import { type Persona, PERSONA_DESCRIPTIONS, PERSONA_EMOJI, PERSONA_LABELS } from './utils/companionPersona';

const GUARDIAN_STORAGE_KEY = 'ongil_guardian_phones_v2';
const CRIME_WMS_KEY = 'W5ZQMXVH-W5ZQ-W5ZQ-W5ZQ-W5ZQMXVHPG';

const GANGNEUNG_CENTER: LatLng = { lat: 37.7519, lng: 128.8761 };

type AppStep = 'search' | 'routes';

function loadGuardianPhones(): [string, string] {
  const stored = localStorage.getItem(GUARDIAN_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return [parsed[0] ?? '', parsed[1] ?? ''];
    } catch {}
  }
  // 이전 버전 단일 번호 마이그레이션
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
  // 경로 계산 시 확정된 출발지 — GPS 틱마다 변하는 effectiveOrigin 대신 KakaoMap에 전달
  const [lockedOrigin, setLockedOrigin] = useState<LatLng | null>(null);

  const effectiveOrigin: LatLng | null = manualOrigin?.position ?? gpsOrigin;

  const [destination, setDestination] = useState<Place | null>(null);
  const [safeRoute, setSafeRoute] = useState<RouteCandidate | null>(null);
  const [fastRoute, setFastRoute] = useState<RouteCandidate | null>(null);
  const [activeRoute, setActiveRoute] = useState<'safe' | 'fast'>('safe');
  const [cctvList, setCctvList] = useState<CctvPoint[]>(GANGNEUNG_CCTV_FALLBACK);
  const [safeSpots, setSafeSpots] = useState<SafeSpot[]>([]);
  const [streetlightData, setStreetlightData] = useState<StreetlightPoint[]>([]);
  const [showOverlays, setShowOverlays] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapClickInfo, setMapClickInfo] = useState<{ lat: number; lng: number; address: string } | null>(null);

  // 실시간 GPS 추적 훅 — watchPosition 기반, heading 포함
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
  const [showGuardianModal, setShowGuardianModal] = useState(false);

  // Kakao Maps SDK 폴링 초기화
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
            'Kakao 개발자 콘솔 → 내 앱 → JavaScript 키 수정\n' +
            '→ JavaScript SDK 도메인에 http://localhost:5173 추가 후 저장'
          );
        }
      }
    }, 100);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  // userLocation → gpsOrigin 동기화 (첫 GPS 확정 시 지도 중심도 이동)
  useEffect(() => {
    if (userLocation) {
      const loc: LatLng = { lat: userLocation.lat, lng: userLocation.lng };
      setGpsOrigin(loc);
      // 지도 중심이 아직 강릉 기본값이면 첫 GPS 좌표로 스냅
      setUserPos((prev) =>
        prev.lat === GANGNEUNG_CENTER.lat && prev.lng === GANGNEUNG_CENTER.lng ? loc : prev
      );
    } else if (locationReady && !userLocation) {
      // GPS 권한 거부 등 실패 → 강릉 센터 폴백
      setGpsOrigin(GANGNEUNG_CENTER);
    }
  }, [userLocation, locationReady]);

  // CCTV + 가로등 데이터 로드
  useEffect(() => {
    loadCctvData().then(setCctvList);
    loadStreetlightData().then(setStreetlightData);
  }, []);

  // SOS 트리거 함수
  const triggerSOSByButton = useCallback(() => {
    setEmergencyTrigger('sos');
    setEmergencyActive(true);
  }, []);

  const triggerSOSByShake = useCallback(() => {
    setEmergencyTrigger('shake');
    setEmergencyActive(true);
  }, []);

  // 핸드폰 세게 2번 흔들기 감지 → SOS
  useShakeDetection(triggerSOSByShake, true);

  // 동행 중 500m마다 보호자 SMS
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

  // 동행 종료 시 SMS 위치 초기화
  useEffect(() => {
    if (!companionActive) lastSmsLocRef.current = null;
  }, [companionActive]);

  const saveGuardianPhones = (phones: [string, string]) => {
    setGuardianPhones(phones);
    localStorage.setItem(GUARDIAN_STORAGE_KEY, JSON.stringify(phones));
    setShowGuardianModal(false);
  };

  const handleOriginSelect = useCallback((place: Place) => {
    setManualOrigin(place);
    setUserPos(place.position);
  }, []);

  const handleOriginReset = useCallback(() => {
    setManualOrigin(null);
    if (gpsOrigin) setUserPos(gpsOrigin);
  }, [gpsOrigin]);

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
        const routes = await fetchPedestrianRoutes(effectiveOrigin, place.position, cctvList, spots, streetlightData);
        const { safeRoute: sr, fastRoute: fr } = pickBestRoute(routes);
        setSafeRoute(sr);
        setFastRoute(fr);
        setActiveRoute('safe');
        setLockedOrigin(effectiveOrigin);
      } catch (e) {
        console.error(e);
        setError('경로를 불러오지 못했습니다. API 키 또는 네트워크를 확인해주세요.');
      } finally {
        setLoading(false);
      }
    },
    [effectiveOrigin, cctvList]
  );

  const handleReset = () => {
    setStep('search');
    setDestination(null);
    setSafeRoute(null);
    setFastRoute(null);
    setLockedOrigin(null);
    setError(null);
  };

  const handleMapClick = useCallback((pos: { lat: number; lng: number }, address: string) => {
    setMapClickInfo({ ...pos, address });
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
    if (!safeRoute) return [];
    return (activeRoute === 'safe' ? safeRoute : (fastRoute ?? safeRoute)).nodes;
  }, [safeRoute, fastRoute, activeRoute]);

  const sampledNodes = useMemo(
    () => activeNodes.filter((_, i) => i % 4 === 0),
    [activeNodes]
  );

  const displayCctv = useMemo((): CctvPoint[] => {
    if (sampledNodes.length === 0) return [];
    return cctvList
      .filter((c) => sampledNodes.some((n) => distanceMeters(c, n) <= 80))
      .slice(0, 200);
  }, [sampledNodes, cctvList]);

  const displaySpots = useMemo((): SafeSpot[] => {
    if (sampledNodes.length === 0) return [];
    return safeSpots
      .filter((s) => sampledNodes.some((n) => distanceMeters(s, n) <= 100))
      .slice(0, 100);
  }, [sampledNodes, safeSpots]);

  const displayStreetlights = useMemo((): StreetlightPoint[] => {
    if (sampledNodes.length === 0) return [];
    return streetlightData
      .filter((l) => sampledNodes.some((n) => distanceMeters(l, n) <= 60))
      .slice(0, 300);
  }, [sampledNodes, streetlightData]);

  const displayChildSafeHouses = useMemo((): ChildSafeHousePoint[] => {
    if (sampledNodes.length === 0) return [];
    return CHILD_SAFE_HOUSES
      .filter((h) => sampledNodes.some((n) => distanceMeters(h, n) <= 120))
      .slice(0, 100);
  }, [sampledNodes]);

  const guardianSetCount = guardianPhones.filter(p => p.trim()).length;

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
        <div style={{ fontSize: '13px', color: '#94A3B8' }}>지도 불러오는 중...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif", background: '#F8FAFC', position: 'relative', overflow: 'hidden' }}>

      {/* 헤더 */}
      <div style={{ background: '#fff', padding: '14px 16px 10px', borderBottom: '1px solid #F1F5F9', zIndex: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          {step === 'routes' && (
            <button onClick={handleReset} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '0', color: '#374151' }}>←</button>
          )}
          <div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#1E3A5F', letterSpacing: '-0.5px' }}>ON:吉 온길</div>
            <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '1px' }}>강릉 야간 안심 이동 서비스</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
            {/* 보호자 설정 버튼 — 항상 표시, 미설정 시 빨간색 경고 */}
            <button
              onClick={() => setShowGuardianModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', padding: '6px 11px', borderRadius: '999px',
                border: `1.5px solid ${guardianSetCount > 0 ? '#10B981' : '#EF4444'}`,
                background: guardianSetCount > 0 ? '#ECFDF5' : '#FFF1F2',
                color: guardianSetCount > 0 ? '#059669' : '#DC2626',
                cursor: 'pointer', fontWeight: 700,
                fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
              }}
            >
              {guardianSetCount > 0 ? `👥 보호자 ${guardianSetCount}명` : '⚠️ 보호자 미설정'}
            </button>
            {step === 'routes' && (
              <button onClick={() => setShowOverlays((v) => !v)} style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '999px', border: '1px solid #E5E7EB', background: showOverlays ? '#EFF6FF' : '#fff', color: showOverlays ? '#2563EB' : '#6B7280', cursor: 'pointer', fontWeight: 600 }}>
                {showOverlays ? '📍 레이어 ON' : '📍 레이어 OFF'}
              </button>
            )}
          </div>
        </div>

        {!locationReady ? (
          <div style={{ textAlign: 'center', padding: '12px', color: '#94A3B8', fontSize: '14px' }}>위치 확인 중...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* 출발지 행 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600, minWidth: '28px' }}>출발</span>
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
                  style={{ padding: '8px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }}
                >
                  📍
                </button>
              )}
            </div>
            {/* 목적지 행 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600, minWidth: '28px' }}>도착</span>
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
      </div>

      {/* 긴급신고 화면 (최우선 오버레이) */}
      {emergencyActive && (
        <EmergencyScreen
          guardianPhones={guardianPhones}
          currentLocation={gpsOrigin}
          trigger={emergencyTrigger}
          onClose={() => setEmergencyActive(false)}
        />
      )}


      {/* 보호자 연락처 설정 모달 */}
      {showGuardianModal && (
        <GuardianModal
          initialPhones={guardianPhones}
          onSave={saveGuardianPhones}
          onClose={() => setShowGuardianModal(false)}
        />
      )}

      {/* 지도 영역 */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <KakaoMap
          center={userPos}
          origin={lockedOrigin ?? manualOrigin?.position ?? null}
          destination={destination?.position ?? null}
          safeRoute={safeRoute}
          fastRoute={fastRoute}
          activeRoute={activeRoute}
          cctvList={showOverlays ? displayCctv : []}
          safeSpots={showOverlays ? displaySpots : []}
          streetlights={showOverlays ? displayStreetlights : []}
          childSafeHouses={showOverlays ? displayChildSafeHouses : []}
          showOverlays={showOverlays}
          onMapClick={handleMapClick}
          userLocation={userLocation}
          crimeWmsKey={CRIME_WMS_KEY}
          showCrimeOverlay={showOverlays}
        />

        {/* 지도 클릭 시 출발지/도착지 설정 바텀시트 */}
        {mapClickInfo && !loading && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
            background: '#fff', borderRadius: '16px 16px 0 0',
            padding: '16px 16px 28px',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
            fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '3px' }}>선택한 위치</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', lineHeight: 1.4 }}>{mapClickInfo.address}</div>
              </div>
              <button
                onClick={() => setMapClickInfo(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#9CA3AF', padding: '2px 4px', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSetOriginFromMap}
                style={{
                  flex: 1, padding: '13px 8px', borderRadius: '12px',
                  background: '#EFF6FF', color: '#2563EB',
                  border: '1.5px solid #BFDBFE',
                  fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
                }}
              >
                📍 출발지로 설정
              </button>
              <button
                onClick={handleSetDestFromMap}
                style={{
                  flex: 1, padding: '13px 8px', borderRadius: '12px',
                  background: '#FEF2F2', color: '#DC2626',
                  border: '1.5px solid #FECACA',
                  fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
                }}
              >
                🏁 도착지로 설정
              </button>
            </div>
          </div>
        )}

        {/* SOS 버튼 (항상 표시, 지도 좌하단) */}
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

        {/* AI 동행 시작 버튼 (지도 우하단 플로팅) */}
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
            👥 AI 음성 대화
          </button>
        )}

        {/* 페르소나 선택 모달 */}
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
                선택한 페르소나와 한국어로 자유롭게 대화해요
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

      {/* AI 음성 대화 */}
      {companionDisplay !== 'hidden' && (
        <CompanionCall
          key={companionKey}
          persona={selectedPersona}
          displayMode={companionDisplay}
          onDisplayModeChange={setCompanionDisplay}
          onEnd={() => setCompanionDisplay('hidden')}
        />
      )}

      {/* 경로 카드 패널 — 동행 중에는 숨김 */}
      {step === 'routes' && !loading && companionDisplay === 'hidden' && (
        <div style={{ background: '#fff', padding: '16px', borderTop: '1px solid #F1F5F9', flexShrink: 0, boxShadow: '0 -4px 20px rgba(0,0,0,0.06)' }}>
          {error ? (
            <div style={{ textAlign: 'center', padding: '16px', color: '#EF4444', fontSize: '14px', background: '#FEF2F2', borderRadius: '12px' }}>⚠️ {error}</div>
          ) : safeRoute ? (
            <>
              <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '10px', fontWeight: 500 }}>
                📍 {destination?.name}까지의 경로
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <RouteCard
                  type="safe"
                  route={safeRoute}
                  active={activeRoute === 'safe'}
                  onClick={() => setActiveRoute('safe')}
                />
                {fastRoute && (
                  <RouteCard
                    type="fast"
                    route={fastRoute}
                    active={activeRoute === 'fast'}
                    onClick={() => setActiveRoute('fast')}
                  />
                )}
              </div>
              {showOverlays && (
                <div style={{ display: 'flex', gap: '10px', marginTop: '12px', padding: '10px 12px', background: '#F8FAFC', borderRadius: '10px', flexWrap: 'wrap' }}>
                  <LegendItem label="CCTV" iconFile="cctv.png" />
                  <LegendItem label="가로등" iconFile="streetlight.png" />
                  <LegendItem label="편의점" iconFile="convenience.png" />
                  <LegendItem label="카페" iconFile="cafe.png" />
                  <LegendItem label="음식점" iconFile="restaurant.png" />
                  <LegendItem label="경찰·지구대" iconFile="police.png" />
                  <LegendItem label="소방서" iconFile="fire.png" />
                </div>
              )}
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

function LegendItem({ label, iconFile }: { label: string; iconFile: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <img src={`/icons/${iconFile}`} width="16" height="16" style={{ borderRadius: '3px', flexShrink: 0, display: 'block' }} />
      <span style={{ fontSize: '11px', color: '#6B7280' }}>{label}</span>
    </div>
  );
}
