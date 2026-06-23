import { useState, useEffect, useRef, useCallback } from 'react';
import { generateCompanionReply, type GeminiMessage, type LocationContext } from '../utils/gemini';
import { distanceMeters } from '../utils/safety';
import { sendGuardianSMSAll, buildGuardianMessage } from '../utils/sms';
import { speakText, cancelTTS } from '../utils/tts';

export type CompanionMode = 'full' | 'companion_only';
export type Phase = 'speaking' | 'listening' | 'thinking';

export interface UseAiCompanionOptions {
  mode: CompanionMode;
  destination?: string;
  guardianPhones?: string[];
  currentLocation?: { lat: number; lng: number } | null;
  routeNodes?: { lat: number; lng: number }[];
  routeType?: 'safe' | 'fast';
  onEnd: () => void;
  onEmergency?: () => void;
}

export interface UseAiCompanionResult {
  phase: Phase;
  callSecs: number;
  micError: string | null;
  lastUserText: string;
  lastAIText: string;
  geminiError: string | null;
  currentAddress: string;
  callStarted: boolean;
  handleStartCall: () => void;
  handleEnd: () => void;
  fmt: (secs: number) => string;
}

const VOICE_ID = import.meta.env.VITE_XI_VOICE_MOM as string;

const EMERGENCY_KEYWORDS = ['신고해줘', '살려줘', '도와줘', '누가 따라와', '쫓아오고 있어', '경찰 불러줘'];
const CHECK_IN_MSGS = [
  '야, 거기 있어? 밥은 먹었어?',
  '우리 딸, 아직 걷고 있어? 주위 한번 둘러봐.',
  '어둡지 않아? 고개 들고 앞 잘 보면서 걸어.',
  '이어폰 한쪽은 빼고 걸어. 엄마 말 들려?',
];

const NO_RESPONSE_MS = 3 * 60 * 1000;
const CHECK_IN_MS = 5 * 60 * 1000;
const DEVIATION_THRESHOLD_M = 150;
const IMPACT_THRESHOLD = 30;
const WALKING_SPEED_MPM = 80;

function calcMinutesRemaining(loc: { lat: number; lng: number }, nodes: { lat: number; lng: number }[]): number {
  if (nodes.length < 2) return 0;
  let minDist = Infinity, closestIdx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const d = distanceMeters(loc, nodes[i]);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }
  let remaining = 0;
  for (let i = closestIdx; i < nodes.length - 1; i++) remaining += distanceMeters(nodes[i], nodes[i + 1]);
  return Math.max(1, Math.round(remaining / WALKING_SPEED_MPM));
}

function calcProgressPercent(loc: { lat: number; lng: number }, nodes: { lat: number; lng: number }[]): number {
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

export function useAiCompanion({
  mode,
  destination,
  guardianPhones,
  currentLocation,
  routeNodes,
  routeType,
  onEnd,
  onEmergency,
}: UseAiCompanionOptions): UseAiCompanionResult {
  const [phase, setPhase] = useState<Phase>('speaking');
  const [callSecs, setCallSecs] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [lastUserText, setLastUserText] = useState('');
  const [lastAIText, setLastAIText] = useState('');
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [currentAddress, setCurrentAddress] = useState('위치 확인 중');
  const [callStarted, setCallStarted] = useState(false);

  const historyRef = useRef<GeminiMessage[]>([]);
  const recRef = useRef<any>(null);
  const phaseRef = useRef<Phase>('speaking');
  const isEndedRef = useRef(false);
  const permissionDeniedRef = useRef(false);
  const processingRef = useRef(false);
  const callReadyRef = useRef(false);
  const noSpeechRetryRef = useRef(0);
  const deviationAlertedRef = useRef(false);
  const impactCooldownRef = useRef(false);
  const currentLocationRef = useRef(currentLocation ?? null);
  const noResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkInTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedRef = useRef<{ lat: number; lng: number } | null>(null);
  const greetingRef = useRef('');
  // stable refs for callbacks that might change
  const onEndRef = useRef(onEnd);
  const onEmergencyRef = useRef(onEmergency);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  useEffect(() => { onEmergencyRef.current = onEmergency; }, [onEmergency]);

  phaseRef.current = phase;

  const isNight = () => { const h = new Date().getHours(); return h >= 19 || h < 6; };

  const buildLocationCtx = useCallback((): LocationContext => {
    if (mode === 'companion_only') {
      return { address: currentAddress, mode: 'companion_only', isDeviated: false, isNight: isNight() };
    }
    return {
      address: currentAddress,
      mode: 'full',
      destination: destination ?? '목적지',
      routeType: routeType === 'fast' ? '빠른길' : '안심길',
      minutesRemaining: currentLocationRef.current && routeNodes?.length
        ? calcMinutesRemaining(currentLocationRef.current, routeNodes) : 0,
      progressPercent: currentLocationRef.current && routeNodes?.length
        ? calcProgressPercent(currentLocationRef.current, routeNodes) : 0,
      isDeviated: deviationAlertedRef.current,
      isNight: isNight(),
    };
  }, [mode, currentAddress, destination, routeType, routeNodes]);

  // GPS 업데이트 → ref 동기화 + 역지오코딩
  useEffect(() => {
    currentLocationRef.current = currentLocation ?? null;
    if (!currentLocation) return;
    const last = lastGeocodedRef.current;
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

  // 통화 시간 카운터 — 전화 받기 후 시작
  useEffect(() => {
    if (!callStarted) return;
    const t = setInterval(() => setCallSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [callStarted]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const resetNoResponseTimer = useCallback(() => {
    if (noResponseTimerRef.current) clearTimeout(noResponseTimerRef.current);
    noResponseTimerRef.current = setTimeout(() => {
      if (isEndedRef.current) return;
      const msg = `🚨 [온길 긴급] 응답이 없습니다.\n현재 위치: https://maps.google.com/?q=${currentLocationRef.current?.lat},${currentLocationRef.current?.lng}\n즉시 확인해주세요.`;
      sendGuardianSMSAll(guardianPhones ?? [], msg);
      onEmergencyRef.current?.();
    }, NO_RESPONSE_MS);
  }, [guardianPhones]);

  const startListening = useCallback(() => {
    if (isEndedRef.current || permissionDeniedRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setMicError('이 브라우저는 음성 인식을 지원하지 않아요. Chrome을 사용해주세요.'); return; }
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

      if (EMERGENCY_KEYWORDS.some(kw => transcript.includes(kw))) {
        processingRef.current = false;
        sendGuardianSMSAll(guardianPhones ?? [], buildGuardianMessage('emergency', currentLocationRef.current));
        onEmergencyRef.current?.();
        return;
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
          const is429 = err.message.includes('429');
          setGeminiError(is429 ? 'AI 서버 요청 한도 초과.' : `AI 연결 오류: ${err.message}`);
          if (!isEndedRef.current) setTimeout(() => { setGeminiError(null); startListening(); }, 4000);
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
  }, [resetNoResponseTimer, guardianPhones, buildLocationCtx]);

  const aiSpeak = useCallback((text: string, afterSpeak?: () => void) => {
    if (isEndedRef.current) return;
    setPhase('speaking');
    historyRef.current = [...historyRef.current, { role: 'model', parts: [{ text }] }];
    speakText(text, VOICE_ID, () => {
      if (afterSpeak) afterSpeak();
      else if (!isEndedRef.current) setTimeout(() => startListening(), 500);
    });
  }, [startListening]);

  // 마운트 시 인사말 준비
  useEffect(() => {
    isEndedRef.current = false;
    callReadyRef.current = false;
    const greeting = mode === 'companion_only'
      ? '야, 우리 딸. 엄마 여기 있어. 잘 가고 있어?'
      : (destination
          ? `어, 우리 딸. ${destination}까지 가는 거야? ${routeType === 'fast' ? '빠른길' : '안심길'}으로 잘 가고 있어. 엄마 여기 있어.`
          : `야, 잘 가고 있어? 엄마 여기 듣고 있어. 어디쯤이야?`);
    greetingRef.current = greeting;
    historyRef.current = [{ role: 'model', parts: [{ text: greeting }] }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartCall = () => {
    setCallStarted(true);
    setPhase('speaking');
    resetNoResponseTimer();
    speakText(greetingRef.current, VOICE_ID, () => {
      callReadyRef.current = true;
      if (!isEndedRef.current) setTimeout(() => startListening(), 800);
    });
  };

  const handleEnd = useCallback(() => {
    isEndedRef.current = true;
    cancelTTS();
    if (recRef.current) { try { recRef.current.abort(); } catch {} }
    if (noResponseTimerRef.current) clearTimeout(noResponseTimerRef.current);
    if (checkInTimerRef.current) clearInterval(checkInTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    onEndRef.current();
  }, []);

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

  useEffect(() => { if (phase) resetSilenceTimer(); }, [phase, resetSilenceTimer]);

  // 경로 이탈 감지 — full 모드에서만 동작
  useEffect(() => {
    if (mode !== 'full') return;
    if (!currentLocation || !routeNodes || routeNodes.length === 0) return;
    if (isEndedRef.current || deviationAlertedRef.current || !callReadyRef.current) return;
    const minDist = Math.min(...routeNodes.map(n => distanceMeters(currentLocation, n)));
    if (minDist > DEVIATION_THRESHOLD_M) {
      deviationAlertedRef.current = true;
      if (recRef.current) { try { recRef.current.abort(); } catch {} recRef.current = null; }
      cancelTTS();
      resetNoResponseTimer();
      aiSpeak('야, 길에서 좀 벗어난 것 같은데? 지금 어디야?');
      setTimeout(() => { deviationAlertedRef.current = false; }, 120_000);
    }
  }, [mode, currentLocation, routeNodes, aiSpeak, resetNoResponseTimer]);

  // 낙하·충격 감지 (두 모드 모두)
  useEffect(() => {
    const handleMotion = (e: DeviceMotionEvent) => {
      if (impactCooldownRef.current || !callReadyRef.current) return;
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const total = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
      if (total > IMPACT_THRESHOLD) {
        impactCooldownRef.current = true;
        setTimeout(() => { impactCooldownRef.current = false; }, 10_000);
        sendGuardianSMSAll(guardianPhones ?? [], buildGuardianMessage('emergency', currentLocationRef.current));
        onEmergencyRef.current?.();
      }
    };
    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [guardianPhones]);

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

  return { phase, callSecs, micError, lastUserText, lastAIText, geminiError, currentAddress, callStarted, handleStartCall, handleEnd, fmt };
}
