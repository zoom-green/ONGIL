import { useEffect, useRef, useCallback } from 'react';
import { useState } from 'react';
import { sendGuardianSMSAll } from '../utils/sms';

interface Props {
  guardianPhones: string[];
  currentLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  trigger?: 'sos' | 'shake';
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

export default function EmergencyScreen({ guardianPhones, currentLocation, onClose, trigger = 'shake' }: Props) {
  const [countdown, setCountdown] = useState(5);
  const [triggered, setTriggered] = useState(false);
  const triggeredRef = useRef(false);
  const stopAlarmRef = useRef<() => void>(() => {});

  const validGuardians = guardianPhones.filter(p => p.trim());

  const mapsLink = currentLocation
    ? `https://maps.google.com/?q=${currentLocation.lat},${currentLocation.lng}`
    : '위치 확인 중';

  // 알람 시작 (SMS는 아직 미발송)
  useEffect(() => {
    stopAlarmRef.current = createAlarm();
    return () => { stopAlarmRef.current(); };
  }, []);

  // SMS 발송 + 112 다이얼러 열기 (한 번만 실행)
  const doTrigger = useCallback(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    setTriggered(true);

    // 보호자 SMS 발송
    const msg = `🚨 [온길 긴급] 위험 상황이 감지되었습니다.\n현재 위치: ${mapsLink}\n경찰(112)에 신고가 접수되었습니다. 즉시 확인해주세요.`;
    sendGuardianSMSAll(validGuardians, msg);

    // 112 다이얼러 열기
    window.location.href = 'tel:112';
  }, [mapsLink, validGuardians]);

  // 5초 카운트다운
  useEffect(() => {
    if (triggered) return;
    if (countdown <= 0) {
      doTrigger();
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, triggered, doTrigger]);

  // 취소: 아무것도 안 함 (SMS 미발송, 112 미연결)
  const handleCancel = () => {
    stopAlarmRef.current();
    onClose();
  };

  // 즉시 신고: 알람 즉시 중단 + SMS + 112
  const handleImmediate = () => {
    stopAlarmRef.current();
    doTrigger();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: '#7F1D1D',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'space-between',
      padding: '56px 24px 48px',
      fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      animation: 'emergency-flash 0.5s ease-in-out 3',
      overflowY: 'auto',
    }}>

      {/* 상단 */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '12px' }}>🚨</div>
        <div style={{ fontSize: '26px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
          긴급 신고
        </div>
        <div style={{ fontSize: '14px', color: '#FCA5A5', marginTop: '6px' }}>
          {trigger === 'sos' ? 'SOS 버튼을 눌렀어요' : '핸드폰을 세게 흔들었어요'}
        </div>
        {!triggered && (
          <div style={{ fontSize: '12px', color: '#FCD34D', marginTop: '6px' }}>
            취소하지 않으면 5초 후 112에 자동 신고돼요
          </div>
        )}
        {triggered && validGuardians.length > 0 && (
          <div style={{ fontSize: '12px', color: '#86EFAC', marginTop: '6px' }}>
            ✅ 보호자 {validGuardians.length}명에게 위치 전송 완료
          </div>
        )}
        {triggered && validGuardians.length === 0 && (
          <div style={{ fontSize: '12px', color: '#FCD34D', marginTop: '6px' }}>
            ⚠️ 보호자 미설정 — SMS 미전송
          </div>
        )}
      </div>

      {/* 중앙: 카운트다운 + 위치 */}
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
        <div style={{
          width: '120px', height: '120px', borderRadius: '50%',
          background: triggered ? '#166534' : 'rgba(255,255,255,0.15)',
          border: `3px solid ${triggered ? '#86EFAC' : 'rgba(255,255,255,0.4)'}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.4s',
        }}>
          {triggered ? (
            <div style={{ fontSize: '13px', color: '#86EFAC', fontWeight: 800, textAlign: 'center', lineHeight: 1.4, padding: '0 8px' }}>
              112<br />연결 중...
            </div>
          ) : (
            <>
              <div style={{ fontSize: '48px', fontWeight: 900, color: '#fff', lineHeight: 1 }}>{countdown}</div>
              <div style={{ fontSize: '11px', color: '#FCA5A5', marginTop: '2px' }}>초 후 112</div>
            </>
          )}
        </div>

        <div style={{
          background: 'rgba(0,0,0,0.3)', borderRadius: '12px',
          padding: '12px 16px', textAlign: 'center', maxWidth: '280px',
        }}>
          <div style={{ fontSize: '11px', color: '#FCA5A5', marginBottom: '4px' }}>현재 위치</div>
          <div style={{ fontSize: '12px', color: '#fff', fontWeight: 600, wordBreak: 'break-all' }}>
            {currentLocation
              ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}`
              : '위치 확인 중...'}
          </div>
          {currentLocation && (
            <button
              onClick={() => navigator.clipboard?.writeText(mapsLink).catch(() => {})}
              style={{ marginTop: '8px', fontSize: '11px', color: '#93C5FD', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              📋 지도 링크 복사
            </button>
          )}
        </div>
      </div>

      {/* 하단: 버튼 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '300px' }}>

        {/* 112 즉시 신고 */}
        {!triggered && (
          <button
            onClick={handleImmediate}
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

        {/* 취소 */}
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

        {/* 신고 완료 후 닫기 */}
        {triggered && (
          <button
            onClick={() => { stopAlarmRef.current(); onClose(); }}
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
