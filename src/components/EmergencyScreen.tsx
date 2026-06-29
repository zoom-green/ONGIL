import { useEffect, useRef, useCallback } from 'react';
import { useState } from 'react';
import { sendGuardianSMSAll } from '../utils/sms';

interface Props {
  guardianPhones: string[];
  currentLocation: { lat: number; lng: number } | null;
  trigger?: 'sos' | 'secret';
  onClose: () => void;
}

function createAlarm(): () => void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let time = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = i % 2 === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.6, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
      osc.start(time);
      osc.stop(time + 0.4);
      time += 0.45;
    }
    return () => { try { ctx.close(); } catch {} };
  } catch {
    return () => {};
  }
}

export default function EmergencyScreen({ guardianPhones, currentLocation, trigger = 'sos', onClose }: Props) {
  const [countdown, setCountdown] = useState(5);
  const [triggered, setTriggered] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const triggeredRef = useRef(false);
  const stopAlarmRef = useRef<() => void>(() => {});

  // SOS 발생 시점의 위치·연락처를 ref로 고정
  // — GPS 틱마다 currentLocation이 바뀌어도 smsMsg·doTrigger가 재생성되지 않도록
  const locationRef = useRef(currentLocation);
  const validGuardians = useRef(guardianPhones.filter(p => p.trim())).current;

  const mapsLink = locationRef.current
    ? `https://maps.google.com/?q=${locationRef.current.lat},${locationRef.current.lng}`
    : '위치 확인 중';
  const isSecretTrigger = trigger === 'secret';
  const smsMsg = isSecretTrigger
    ? `🚨 [온길 긴급] 사용자의 긴급 암호가 감지되었습니다.\n현재 위치: ${mapsLink}\n위급 상황일 수 있습니다. 즉시 연락하거나 112에 신고해주세요.`
    : `🚨 [온길 긴급] 위험 상황이 감지되었습니다.\n현재 위치: ${mapsLink}\n경찰(112)에 신고가 접수되었습니다. 즉시 확인해주세요.`;
  const progress = Math.max(0, Math.min(1, countdown / 5));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    stopAlarmRef.current = createAlarm();
    return () => { stopAlarmRef.current(); };
  }, []);

  // trigger 실행: 알람 중단 + 112 자동 다이얼 + 화면 전환
  // deps를 ref로 처리했으므로 빈 배열 → countdown 타이머가 GPS 틱에 의해 reset되지 않음
  const doTrigger = useCallback(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    setTriggered(true);
    stopAlarmRef.current();
    // 112 자동 다이얼 (모바일: 전화 앱 다이얼러 열림, 앱은 백그라운드 유지)
    window.location.href = 'tel:112';
  }, []);

  // 5초 카운트다운
  useEffect(() => {
    if (triggered) return;
    if (countdown <= 0) { doTrigger(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, triggered, doTrigger]);

  // 보호자 SMS 발송 — SMS 앱 열어서 전송 (웹 브라우저 한계)
  const sendSMS = useCallback(() => {
    if (smsSent) return;
    setSmsSent(true);
    sendGuardianSMSAll(validGuardians, smsMsg);
  }, [smsSent, validGuardians, smsMsg]);

  useEffect(() => {
    if (!isSecretTrigger || smsSent || validGuardians.length === 0) return;
    setSmsSent(true);
    sendGuardianSMSAll(validGuardians, smsMsg);
  }, [isSecretTrigger, smsSent, validGuardians, smsMsg]);

  const handleCancel = () => {
    stopAlarmRef.current();
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: '#7F1D1D',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'space-between',
      padding: '52px 20px 118px',
      fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      animation: triggered ? 'none' : 'emergency-flash 0.5s ease-in-out 3',
      overflowY: 'auto',
    }}>

      {/* 상단 */}
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: '56px', marginBottom: '10px' }}>🚨</div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
          {triggered ? '신고 완료' : '긴급 신고'}
        </div>
        <div style={{ fontSize: '13px', color: '#FCA5A5', marginTop: '5px' }}>
          {isSecretTrigger ? '긴급 암호가 감지됐어요' : 'SOS 버튼을 눌렀어요'}
        </div>
        {!triggered && (
          <div style={{ fontSize: '12px', color: '#FCD34D', marginTop: '5px' }}>
            취소하지 않으면 5초 후 자동 신고돼요
          </div>
        )}
      </div>

      {/* 중앙 */}
      {!triggered ? (
        /* 카운트다운 */
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <div style={{
            width: 138,
            height: 138,
            borderRadius: '50%',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="138" height="138" viewBox="0 0 138 138" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
              <circle cx="69" cy="69" r={radius} fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth="7" />
              <circle
                cx="69"
                cy="69"
                r={radius}
                fill="none"
                stroke="#fff"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
                style={{ transition: 'stroke-dashoffset 0.35s ease' }}
              />
            </svg>
            <div style={{ fontSize: '52px', fontWeight: 900, color: '#fff', lineHeight: 1, position: 'relative' }}>{countdown}</div>
            <div style={{ fontSize: '11px', color: '#FDE2D6', marginTop: '7px', fontWeight: 900, position: 'relative', width: 76, lineHeight: 1.2, wordBreak: 'keep-all' }}>
              초 후<br />112 연결
            </div>
          </div>
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: '12px',
            padding: '12px 16px', textAlign: 'center', maxWidth: '280px',
          }}>
            <div style={{ fontSize: '11px', color: '#FCA5A5', marginBottom: '4px' }}>현재 위치</div>
            <div style={{ fontSize: '12px', color: '#fff', fontWeight: 600, wordBreak: 'break-all' }}>
              {locationRef.current
                ? `${locationRef.current.lat.toFixed(5)}, ${locationRef.current.lng.toFixed(5)}`
                : '위치 확인 중...'}
            </div>
          </div>
        </div>
      ) : (
        /* 신고 완료 — 112 카드 + SMS 카드 동시 표시 */
        <div style={{ width: '100%', maxWidth: '340px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          <div style={{ display: 'flex', gap: '10px' }}>

            {/* 112 신고 카드 */}
            <div style={{
              flex: 1, background: 'rgba(22,101,52,0.85)', borderRadius: '16px',
              border: '1.5px solid #4ADE80',
              padding: '16px 12px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '8px',
            }}>
              <div style={{ fontSize: '30px' }}>📞</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff', textAlign: 'center' }}>112 신고</div>
              <div style={{ fontSize: '11px', color: '#86EFAC', textAlign: 'center', lineHeight: 1.4 }}>
                경찰청<br />긴급 신고
              </div>
              <a
                href="tel:112"
                style={{
                  display: 'block', width: '100%', textAlign: 'center', boxSizing: 'border-box',
                  background: '#22C55E', color: '#fff', borderRadius: '10px',
                  padding: '10px 8px', fontSize: '13px', fontWeight: 800,
                  textDecoration: 'none', marginTop: '4px',
                }}
              >
                📞 전화 연결
              </a>
            </div>

            {/* 보호자 SMS 카드 */}
            <div style={{
              flex: 1, background: 'rgba(30,58,95,0.85)', borderRadius: '16px',
              border: '1.5px solid #60A5FA',
              padding: '16px 12px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '8px',
            }}>
              <div style={{ fontSize: '30px' }}>💬</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff', textAlign: 'center' }}>보호자 SMS</div>
              <div style={{ fontSize: '11px', color: '#93C5FD', textAlign: 'center', lineHeight: 1.4 }}>
                {validGuardians.length > 0
                  ? `${validGuardians.length}명에게 발송`
                  : '보호자\n미설정 ⚠️'}
              </div>
              <button
                onClick={sendSMS}
                disabled={smsSent}
                style={{
                  width: '100%', background: smsSent ? 'rgba(59,130,246,0.4)' : '#3B82F6',
                  color: '#fff', borderRadius: '10px', padding: '10px 8px',
                  fontSize: '13px', fontWeight: 800, border: 'none',
                  cursor: smsSent ? 'default' : 'pointer', marginTop: '4px',
                }}
              >
                {smsSent ? '✅ 발송 완료' : '💬 문자 보내기'}
              </button>
            </div>
          </div>

          {/* SMS 메시지 미리보기 */}
          <div style={{
            background: 'rgba(0,0,0,0.35)', borderRadius: '12px', padding: '14px',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ fontSize: '11px', color: '#93C5FD', marginBottom: '8px', fontWeight: 700 }}>
              📱 발송되는 문자 내용
            </div>
            <div style={{ fontSize: '12px', color: '#E2E8F0', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
              {smsMsg}
            </div>
          </div>
        </div>
      )}

      {/* 하단 버튼 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '300px', flexShrink: 0 }}>
        {!triggered && (
          <button
            onClick={doTrigger}
            style={{
              padding: '18px', borderRadius: '14px', border: 'none',
              background: '#fff', color: '#7F1D1D',
              fontSize: '17px', fontWeight: 900, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
          >
            📞 112 즉시 신고 (경찰)
          </button>
        )}
        {!triggered && (
          <button
            onClick={handleCancel}
            style={{
              padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(0,0,0,0.3)', color: '#9CA3AF',
              fontSize: '14px', cursor: 'pointer',
            }}
          >
            오발동이에요 — 취소
          </button>
        )}
        {triggered && (
          <button
            onClick={() => onClose()}
            style={{
              padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(0,0,0,0.3)', color: '#9CA3AF',
              fontSize: '14px', cursor: 'pointer',
            }}
          >
            화면 닫기
          </button>
        )}
      </div>

      <style>{`
        @keyframes emergency-flash {
          0%, 100% { background: #7F1D1D; }
          50% { background: #991B1B; }
        }
      `}</style>
    </div>
  );
}
