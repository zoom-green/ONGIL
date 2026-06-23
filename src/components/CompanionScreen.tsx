import { useState, useEffect, useRef, useCallback } from 'react';
import { generateCompanionReply, type GeminiMessage, type LocationContext } from '../utils/gemini';
import { distanceMeters } from '../utils/safety';
import { sendGuardianSMSAll, buildGuardianMessage } from '../utils/sms';
import { speakText, cancelTTS } from '../utils/tts';

interface Props {
  onEnd: () => void;
  onEmergency?: () => void;
  destination?: string;
  guardianPhones?: string[];
  currentLocation?: { lat: number; lng: number } | null;
  routeNodes?: { lat: number; lng: number }[];
  routeType?: 'safe' | 'fast';
}

type Phase = 'speaking' | 'listening' | 'thinking';

const VOICE_ID = import.meta.env.VITE_XI_VOICE_MOM as string;

const GREETING = (dest?: string, routeType?: string) => {
  const route = routeType === 'fast' ? '빠른길' : '안심길';
  return dest
    ? `어, 우리 딸. ${dest}까지 가는 거야? ${route}으로 잘 가고 있어. 엄마 여기 있어.`
    : `야, 잘 가고 있어? 엄마 여기 듣고 있어. 어디쯤이야?`;
};

const CHECK_IN_MSGS = [
  '야, 거기 있어? 밥은 먹었어?',
  '우리 딸, 아직 걷고 있어? 주위 한번 둘러봐.',
  '어둡지 않아? 고개 들고 앞 잘 보면서 걸어.',
  '이어폰 한쪽은 빼고 걸어. 엄마 말 들려?',
];

const DEVIATION_MSG = '야, 길에서 좀 벗어난 것 같은데? 지금 어디야?';

const EMERGENCY_KEYWORDS = ['신고해줘', '살려줘', '도와줘', '누가 따라와', '쫓아오고 있어', '경찰 불러줘'];

const NO_RESPONSE_MS    = 3 * 60 * 1000; // 3분 무응답 → 보호자 알림
const CHECK_IN_MS       = 5 * 60 * 1000; // 5분마다 안부 확인
const DEVIATION_THRESHOLD_M = 150;        // 경로 이탈 기준 거리
const IMPACT_THRESHOLD      = 30;         // 가속도 m/s² (낙하·충격 감지)
const WALKING_SPEED_MPM     = 80;         // 평균 보행 속도 m/분

// 남은 경로 거리 → 분 계산
function calcMinutesRemaining(
  loc: { lat: number; lng: number },
  nodes: { lat: number; lng: number }[]
): number {
  if (nodes.length < 2) return 0;
  let minDist = Infinity, closestIdx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const d = distanceMeters(loc, nodes[i]);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }
  let remaining = 0;
  for (let i = closestIdx; i < nodes.length - 1; i++) {
    remaining += distanceMeters(nodes[i], nodes[i + 1]);
  }
  return Math.max(1, Math.round(remaining / WALKING_SPEED_MPM));
}

// 전체 경로 대비 진행률 계산
function calcProgressPercent(
  loc: { lat: number; lng: number },
  nodes: { lat: number; lng: number }[]
): number {
  if (nodes.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i++) total += distanceMeters(nodes[i], nodes[i + 1]);
  if (total === 0) return 0;
  let minDist = Infinity, closestIdx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const d = distanceMeters(loc, nodes[i]);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }
  let remaining = 0;
  for (let i = closestIdx; i < nodes.length - 1; i++) remaining += distanceMeters(nodes[i], nodes[i + 1]);
  return Math.round(((total - remaining) / total) * 100);
}

export default function CompanionScreen({
  onEnd, onEmergency, destination, guardianPhones, currentLocation, routeNodes, routeType,
}: Props) {
  const [phase, setPhase] = useState<Phase>('speaking');
  const [callSecs, setCallSecs] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [lastUserText, setLastUserText] = useState('');
  const [lastAIText, setLastAIText] = useState('');
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [currentAddress, setCurrentAddress] = useState('위치 확인 중');
  const [callStarted, setCallStarted] = useState(false);
  const greetingRef = useRef('');

  const historyRef            = useRef<GeminiMessage[]>([]);
  const recRef                = useRef<any>(null);
  const phaseRef              = useRef<Phase>('speaking');
  const isEndedRef            = useRef(false);
  const permissionDeniedRef   = useRef(false);
  const processingRef         = useRef(false);
  const callReadyRef          = useRef(false);
  const noSpeechRetryRef      = useRef(0);
  const deviationAlertedRef   = useRef(false);
  const impactCooldownRef     = useRef(false);
  const currentLocationRef    = useRef(currentLocation ?? null);
  const noResponseTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkInTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedRef       = useRef<{ lat: number; lng: number } | null>(null);

  phaseRef.current = phase;

  const isNight = () => { const h = new Date().getHours(); return h >= 19 || h < 6; };

  const buildLocationCtx = useCallback((): LocationContext => ({
    mode: 'full',
    address: currentAddress,
    destination: destination ?? '목적지',
    routeType: routeType === 'fast' ? '빠른길' : '안심길',
    minutesRemaining: currentLocationRef.current && routeNodes?.length
      ? calcMinutesRemaining(currentLocationRef.current, routeNodes)
      : 0,
    progressPercent: currentLocationRef.current && routeNodes?.length
      ? calcProgressPercent(currentLocationRef.current, routeNodes)
      : 0,
    isDeviated: deviationAlertedRef.current,
    isNight: isNight(),
  }), [currentAddress, destination, routeType, routeNodes]);

  // GPS 업데이트 → ref 동기화 + 역지오코딩
  useEffect(() => {
    currentLocationRef.current = currentLocation ?? null;

    if (!currentLocation) return;
    const last = lastGeocodedRef.current;
    // 50m 이상 이동했을 때만 역지오코딩 호출
    if (last && distanceMeters(currentLocation, last) < 50) return;
    lastGeocodedRef.current = currentLocation;

    const w = window as any;
    if (!w.kakao?.maps?.services?.Geocoder) return;
    const gc = new w.kakao.maps.services.Geocoder();
    gc.coord2Address(currentLocation.lng, currentLocation.lat, (result: any, status: string) => {
      if (status !== 'OK' || !result[0]) return;
      const a = result[0];
      const addr = a.road_address?.address_name || a.address?.address_name || '';
      if (addr) setCurrentAddress(addr);
    });
  }, [currentLocation]);

  // 통화 시간 카운터
  useEffect(() => {
    const t = setInterval(() => setCallSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  // 3분 무응답 타이머 (reset on every user speech)
  const resetNoResponseTimer = useCallback(() => {
    if (noResponseTimerRef.current) clearTimeout(noResponseTimerRef.current);
    noResponseTimerRef.current = setTimeout(() => {
      if (isEndedRef.current) return;
      const msg = `🚨 [온길 긴급] 응답이 없습니다.\n현재 위치: https://maps.google.com/?q=${currentLocationRef.current?.lat},${currentLocationRef.current?.lng}\n경찰(112)에 신고가 접수되었습니다. 즉시 확인해주세요.`;
      sendGuardianSMSAll(guardianPhones ?? [], msg);
      if (onEmergency) onEmergency();
    }, NO_RESPONSE_MS);
  }, [guardianPhones, onEmergency]);

  // STT 시작
  const startListening = useCallback(() => {
    if (isEndedRef.current || permissionDeniedRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError('이 브라우저는 음성 인식을 지원하지 않아요. Chrome을 사용해주세요.');
      return;
    }
    if (recRef.current) { try { recRef.current.abort(); } catch {} }
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    recRef.current = rec;
    setPhase('listening');

    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript.trim();
      recRef.current = null;
      noSpeechRetryRef.current = 0;
      if (!transcript) { startListening(); return; }

      processingRef.current = true;
      phaseRef.current = 'thinking';
      setLastUserText(transcript);
      resetNoResponseTimer();

      // 긴급 키워드 즉시 신고
      if (EMERGENCY_KEYWORDS.some(kw => transcript.includes(kw))) {
        processingRef.current = false;
        sendGuardianSMSAll(
          guardianPhones ?? [],
          buildGuardianMessage('emergency', currentLocationRef.current)
        );
        if (onEmergency) { onEmergency(); return; }
      }

      setPhase('thinking');
      const ctx = buildLocationCtx();

      generateCompanionReply(historyRef.current, transcript, ctx)
        .then(reply => {
          if (isEndedRef.current) return;
          historyRef.current = [
            ...historyRef.current,
            { role: 'user', parts: [{ text: transcript }] },
            { role: 'model', parts: [{ text: reply }] },
          ];
          setLastAIText(reply);
          setPhase('speaking');
          speakText(reply, VOICE_ID, () => {
            processingRef.current = false;
            if (!isEndedRef.current) setTimeout(() => startListening(), 1200);
          });
        })
        .catch((err: Error) => {
          processingRef.current = false;
          console.error('[Gemini]', err.message);
          const is429 = err.message.includes('429');
          setGeminiError(is429
            ? 'AI 서버 요청 한도 초과. 새 API 키가 필요해요.'
            : `AI 연결 오류: ${err.message}`
          );
          if (!isEndedRef.current) setTimeout(() => {
            setGeminiError(null);
            startListening();
          }, 4000);
        });
    };

    rec.onerror = (e: any) => {
      recRef.current = null;
      if (isEndedRef.current) return;
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        permissionDeniedRef.current = true;
        setMicError('마이크 권한이 없어요. 브라우저 설정에서 마이크를 허용해주세요.');
        return;
      }
      if (e.error === 'no-speech') noSpeechRetryRef.current += 1;
    };

    rec.onend = () => {
      if (processingRef.current || phaseRef.current !== 'listening' || isEndedRef.current || permissionDeniedRef.current) return;
      const delay = noSpeechRetryRef.current > 3 ? 2000 : 600;
      setTimeout(() => { if (!isEndedRef.current && !processingRef.current) startListening(); }, delay);
    };

    try { rec.start(); } catch { setTimeout(() => { if (!isEndedRef.current) startListening(); }, 1000); }
  }, [resetNoResponseTimer, guardianPhones, onEmergency, buildLocationCtx]);

  // AI 발화
  const aiSpeak = useCallback((text: string, afterSpeak?: () => void) => {
    if (isEndedRef.current) return;
    setPhase('speaking');
    historyRef.current = [...historyRef.current, { role: 'model', parts: [{ text }] }];
    speakText(text, VOICE_ID, () => {
      if (afterSpeak) afterSpeak();
      else if (!isEndedRef.current) setTimeout(() => startListening(), 500);
    });
  }, [startListening]);

  // 컴포넌트 마운트: 인사말 준비만 (speakText는 버튼 클릭 시)
  useEffect(() => {
    isEndedRef.current = false;   // StrictMode 이중 마운트 시 cleanup이 true로 설정하므로 반드시 초기화
    callReadyRef.current = false;
    const greeting = GREETING(destination, routeType);
    greetingRef.current = greeting;
    historyRef.current = [{ role: 'model', parts: [{ text: greeting }] }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 전화 받기 버튼 클릭 → 클릭 이벤트 안에서 speakText 호출 (Chrome 오디오 정책 우회)
  const handleStartCall = () => {
    setCallStarted(true);
    setPhase('speaking');
    resetNoResponseTimer();
    speakText(greetingRef.current, VOICE_ID, () => {
      callReadyRef.current = true;
      if (!isEndedRef.current) setTimeout(() => startListening(), 800);
    });
  };

  // 5분 체크인
  useEffect(() => {
    checkInTimerRef.current = setInterval(() => {
      if (isEndedRef.current) return;
      if (recRef.current) { try { recRef.current.abort(); } catch {} recRef.current = null; }
      cancelTTS();
      aiSpeak(CHECK_IN_MSGS[Math.floor(Math.random() * CHECK_IN_MSGS.length)]);
    }, CHECK_IN_MS);
    return () => { if (checkInTimerRef.current) clearInterval(checkInTimerRef.current); };
  }, [aiSpeak]);

  // 90초 침묵 체크
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (!isEndedRef.current) aiSpeak('거기 있어? 대답 좀 해봐.');
    }, 90_000);
  }, [aiSpeak]);

  useEffect(() => {
    if (phase) resetSilenceTimer();
  }, [phase, resetSilenceTimer]);

  // 기능 4 — 경로 이탈 감지
  useEffect(() => {
    if (!currentLocation || !routeNodes || routeNodes.length === 0) return;
    if (isEndedRef.current || deviationAlertedRef.current || !callReadyRef.current) return;

    const minDist = Math.min(...routeNodes.map(n => distanceMeters(currentLocation, n)));
    if (minDist > DEVIATION_THRESHOLD_M) {
      deviationAlertedRef.current = true;
      if (recRef.current) { try { recRef.current.abort(); } catch {} recRef.current = null; }
      cancelTTS();
      resetNoResponseTimer(); // 기능 5: 이 시점부터 3분 타이머 시작
      aiSpeak(DEVIATION_MSG);
      setTimeout(() => { deviationAlertedRef.current = false; }, 120_000);
    }
  }, [currentLocation, routeNodes, aiSpeak, resetNoResponseTimer]);

  // 기능 6 — 낙하·충격 감지 (가속도계)
  useEffect(() => {
    const handleMotion = (e: DeviceMotionEvent) => {
      if (impactCooldownRef.current || !callReadyRef.current) return;
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const total = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
      if (total > IMPACT_THRESHOLD) {
        impactCooldownRef.current = true;
        setTimeout(() => { impactCooldownRef.current = false; }, 10_000); // 10초 쿨다운
        sendGuardianSMSAll(
          guardianPhones ?? [],
          buildGuardianMessage('emergency', currentLocationRef.current)
        );
        if (onEmergency) onEmergency();
      }
    };
    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [guardianPhones, onEmergency]);

  // 언마운트 정리
  useEffect(() => {
    return () => {
      isEndedRef.current = true;
      cancelTTS();
      if (recRef.current) { try { recRef.current.abort(); } catch {} }
      if (noResponseTimerRef.current) clearTimeout(noResponseTimerRef.current);
      if (checkInTimerRef.current) clearInterval(checkInTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const phaseColor = phase === 'speaking' ? '#7C3AED' : phase === 'thinking' ? '#60A5FA' : '#34D399';
  const phaseLabel = phase === 'speaking' ? '말하는 중' : phase === 'thinking' ? '생각하는 중' : '듣는 중...';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'linear-gradient(180deg,#0f0f1a 0%,#1a1a2e 50%,#0f3460 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'space-between',
      fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      color: '#fff', padding: '60px 24px 52px',
    }}>

      {/* 전화 받기 오버레이 (Chrome 오디오 정책: 클릭 이벤트 필요) */}
      {!callStarted && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'rgba(15,15,26,0.92)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px',
        }}>
          <div style={{ fontSize: '56px', animation: 'ring 1s ease-in-out infinite' }}>📞</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>엄마가 전화했어요</div>
          <button
            onClick={handleStartCall}
            style={{
              marginTop: '8px', padding: '18px 48px', borderRadius: '50px', border: 'none',
              background: '#22C55E', color: '#fff', fontSize: '17px', fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 0 24px rgba(34,197,94,0.5)',
            }}
          >
            전화 받기
          </button>
          <style>{`@keyframes ring { 0%,100%{transform:rotate(-15deg)} 50%{transform:rotate(15deg)} }`}</style>
        </div>
      )}

      {/* 상단: 통화 시간 + 주소 */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '13px', color: '#94A3B8' }}>통화 중 · {fmt(callSecs)}</div>
        <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>{currentAddress}</div>
        {destination && (
          <div style={{ fontSize: '11px', color: '#60A5FA', marginTop: '2px' }}>
            → {destination} ({routeType === 'fast' ? '빠른길' : '안심길'})
          </div>
        )}
      </div>

      {/* 중앙: AI 아바타 + 상태 */}
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
        {phase !== 'thinking' && (
          <div style={{
            position: 'absolute',
            width: '150px', height: '150px', borderRadius: '50%',
            border: `2px solid ${phaseColor}`,
            opacity: 0.35,
            animation: 'pulse-ring 1.4s ease-out infinite',
          }} />
        )}
        <div style={{
          width: '110px', height: '110px', borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, ${phaseColor}, ${phaseColor}66)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '48px',
          boxShadow: `0 0 40px ${phaseColor}55`,
          transition: 'all 0.4s ease',
          position: 'relative',
        }}>
          🤝
        </div>
        <div style={{ fontSize: '22px', fontWeight: 700 }}>AI 동행</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 18px', borderRadius: '999px',
          background: 'rgba(255,255,255,0.08)',
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: phaseColor,
            animation: phase !== 'thinking' ? 'blink 1s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: '14px', color: '#CBD5E1' }}>{phaseLabel}</span>
        </div>
      </div>

      {/* 대화 말풍선 */}
      <div style={{ width: '100%', maxWidth: '340px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {lastAIText && (
          <div style={{
            padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
            fontSize: '14px', color: '#E2E8F0', lineHeight: 1.5,
            alignSelf: 'flex-start', maxWidth: '90%',
          }}>
            <span style={{ fontSize: '11px', color: '#A78BFA', display: 'block', marginBottom: '4px' }}>AI 동행</span>
            {lastAIText}
          </div>
        )}
        {lastUserText && (
          <div style={{
            padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
            background: 'rgba(255,255,255,0.1)',
            fontSize: '14px', color: '#CBD5E1', lineHeight: 1.5,
            alignSelf: 'flex-end', maxWidth: '90%',
          }}>
            <span style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>나</span>
            {lastUserText}
          </div>
        )}
      </div>

      {/* 오류 메시지 */}
      {micError && (
        <div style={{
          padding: '10px 14px', borderRadius: '10px',
          background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
          fontSize: '13px', color: '#FCA5A5', textAlign: 'center', maxWidth: '300px',
        }}>
          🎤 {micError}
        </div>
      )}
      {geminiError && (
        <div style={{
          padding: '10px 14px', borderRadius: '10px',
          background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)',
          fontSize: '13px', color: '#FCD34D', textAlign: 'center', maxWidth: '300px',
        }}>
          ⚠️ {geminiError}
        </div>
      )}

      {/* 통화 종료 버튼 */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={onEnd}
          style={{
            width: '68px', height: '68px', borderRadius: '50%', border: 'none',
            background: '#EF4444', cursor: 'pointer', fontSize: '28px',
            boxShadow: '0 4px 24px rgba(239,68,68,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          📵
        </button>
        <div style={{ fontSize: '12px', color: '#64748B', marginTop: '8px' }}>통화 종료</div>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; } 50% { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}
