import { useRealtimeCompanion, type RealtimePhase } from '../hooks/useRealtimeCompanion';
import { PERSONA_EMOJI, PERSONA_LABELS, type Persona } from '../utils/companionPersona';

export type CompanionDisplayMode = 'mini' | 'fullscreen';

interface Props {
  persona: Persona;
  displayMode: CompanionDisplayMode;
  onDisplayModeChange: (mode: CompanionDisplayMode) => void;
  onEnd: () => void;
}

const PHASE_LABELS: Record<RealtimePhase, string> = {
  idle: '대기 중',
  connecting: '연결 중',
  listening: '듣는 중',
  speaking: '말하는 중',
};

const PHASE_COLORS: Record<RealtimePhase, string> = {
  idle: '#94A3B8',
  connecting: '#60A5FA',
  listening: '#34D399',
  speaking: '#A78BFA',
};

export default function CompanionCall({
  persona,
  displayMode,
  onDisplayModeChange,
  onEnd,
}: Props) {
  const { phase, callSecs, error, callStarted, startCall, endCall, fmt } = useRealtimeCompanion({
    persona,
    onEnd,
  });

  if (displayMode === 'mini') {
    return (
      <div
        onClick={() => onDisplayModeChange('fullscreen')}
        style={{
          background: '#111827',
          borderTop: '1px solid rgba(255,255,255,0.12)',
          color: '#fff',
          padding: '12px 14px',
          cursor: 'pointer',
          fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '26px' }}>{PERSONA_EMOJI[persona]}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 800 }}>
              {PERSONA_LABELS[persona]}와 통화 중
            </div>
            <div style={{ fontSize: '11px', color: '#CBD5E1', marginTop: '2px' }}>
              {PHASE_LABELS[phase]} · {fmt(callSecs)}
            </div>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDisplayModeChange('fullscreen');
            }}
            style={iconButtonStyle}
            title="크게 보기"
          >
            ↑
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              endCall();
            }}
            style={{ ...iconButtonStyle, background: '#EF4444' }}
            title="통화 종료"
          >
            ✕
          </button>
        </div>
        {error && <div style={miniErrorStyle}>{error}</div>}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'linear-gradient(180deg,#111827 0%,#1F2937 52%,#312E81 100%)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '48px 18px 12px' }}>
        <button
          onClick={() => onDisplayModeChange('mini')}
          style={topButtonStyle}
          title="작게 보기"
        >
          ↓
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#CBD5E1' }}>{callStarted ? `통화 중 · ${fmt(callSecs)}` : '음성 대화'}</div>
          <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '4px' }}>{PERSONA_LABELS[persona]}</div>
        </div>
        <div style={{ width: '40px' }} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', gap: '22px' }}>
        <div style={{ position: 'relative', width: '156px', height: '156px', display: 'grid', placeItems: 'center' }}>
          {callStarted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: `2px solid ${PHASE_COLORS[phase]}`,
                animation: phase === 'speaking' ? 'voice-pulse 1.1s ease-out infinite' : 'voice-pulse 1.8s ease-out infinite',
                opacity: 0.55,
              }}
            />
          )}
          <div
            style={{
              width: '118px',
              height: '118px',
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: '54px',
              background: `radial-gradient(circle at 35% 30%, ${PHASE_COLORS[phase]}, rgba(255,255,255,0.08))`,
              boxShadow: `0 0 42px ${PHASE_COLORS[phase]}66`,
            }}
          >
            {PERSONA_EMOJI[persona]}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 900, marginBottom: '8px' }}>
            {PERSONA_LABELS[persona]}와 대화하기
          </div>
          <div style={{ fontSize: '14px', color: '#CBD5E1', lineHeight: 1.5 }}>
            {callStarted ? '말하면 바로 듣고 답해요.' : '마이크를 허용하면 바로 통화가 시작돼요.'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 16px',
            borderRadius: '999px',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: PHASE_COLORS[phase] }} />
          <span style={{ fontSize: '14px', color: '#E5E7EB' }}>{PHASE_LABELS[phase]}</span>
        </div>

        {error && (
          <div
            style={{
              maxWidth: '320px',
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.16)',
              border: '1px solid rgba(248,113,113,0.45)',
              color: '#FECACA',
              fontSize: '13px',
              lineHeight: 1.5,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ padding: '0 24px 48px', display: 'flex', justifyContent: 'center' }}>
        {callStarted ? (
          <button onClick={endCall} style={endButtonStyle}>
            통화 종료
          </button>
        ) : (
          <button onClick={() => void startCall()} disabled={phase === 'connecting'} style={startButtonStyle}>
            {phase === 'connecting' ? '연결 중...' : '통화 시작'}
          </button>
        )}
      </div>

      <style>{`
        @keyframes voice-pulse {
          0% { transform: scale(0.92); opacity: 0.55; }
          100% { transform: scale(1.18); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

const iconButtonStyle = {
  width: '34px',
  height: '34px',
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(255,255,255,0.14)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 900,
} as const;

const topButtonStyle = {
  ...iconButtonStyle,
  width: '40px',
  height: '40px',
  fontSize: '18px',
};

const miniErrorStyle = {
  marginTop: '8px',
  padding: '8px 10px',
  borderRadius: '8px',
  background: 'rgba(239,68,68,0.16)',
  color: '#FECACA',
  fontSize: '12px',
  lineHeight: 1.4,
} as const;

const startButtonStyle = {
  minWidth: '156px',
  padding: '16px 26px',
  borderRadius: '999px',
  border: 'none',
  background: '#22C55E',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 900,
  cursor: 'pointer',
  boxShadow: '0 12px 28px rgba(34,197,94,0.35)',
  fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
} as const;

const endButtonStyle = {
  ...startButtonStyle,
  background: '#EF4444',
  boxShadow: '0 12px 28px rgba(239,68,68,0.35)',
};
