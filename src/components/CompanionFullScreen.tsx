/**
 * CompanionFullScreen — AI 동행 전체화면 UI (순수 표시 컴포넌트).
 * useAiCompanion 훅은 CompanionWrapper에서 관리되며, 상태를 props로만 받는다.
 * position:fixed 로 지도 위를 완전히 덮고, onMinimize 로 미니 패널 전환.
 */
import type { Phase, CompanionMode } from '../hooks/useAiCompanion';

interface Props {
  mode: CompanionMode;
  phase: Phase;
  callSecs: number;
  micError: string | null;
  lastUserText: string;
  lastAIText: string;
  geminiError: string | null;
  currentAddress: string;
  callStarted: boolean;
  destination?: string;
  routeType?: 'safe' | 'fast';
  handleStartCall: () => void;
  handleEnd: () => void;
  fmt: (secs: number) => string;
  onMinimize: () => void;
}

export default function CompanionFullScreen({
  mode, phase, callSecs, micError, lastUserText, lastAIText, geminiError,
  currentAddress, callStarted, destination, routeType,
  handleStartCall, handleEnd, fmt, onMinimize,
}: Props) {
  const phaseColor = phase === 'speaking' ? '#7C3AED' : phase === 'thinking' ? '#60A5FA' : '#34D399';
  const phaseLabel = phase === 'speaking' ? '말하는 중' : phase === 'thinking' ? '생각하는 중' : '듣는 중...';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'linear-gradient(180deg,#0f0f1a 0%,#1a1a2e 50%,#0f3460 100%)',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      color: '#fff',
    }}>

      {/* 전화 받기 오버레이 */}
      {!callStarted && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'rgba(15,15,26,0.95)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '24px',
        }}>
          <div style={{ fontSize: '56px', animation: 'ring 1s ease-in-out infinite' }}>📞</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>엄마가 전화했어요</div>
          <button
            onClick={handleStartCall}
            style={{
              marginTop: '8px', padding: '18px 48px', borderRadius: '50px', border: 'none',
              background: '#22C55E', color: '#fff', fontSize: '17px', fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 0 24px rgba(34,197,94,0.5)',
              fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
            }}
          >전화 받기</button>
          <style>{`@keyframes ring { 0%,100%{transform:rotate(-15deg)} 50%{transform:rotate(15deg)} }`}</style>
        </div>
      )}

      {/* 상단 바: 줄이기 + 통화 정보 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '52px 20px 12px', flexShrink: 0,
      }}>
        <button
          onClick={onMinimize}
          style={{
            background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%',
            width: '40px', height: '40px', cursor: 'pointer', fontSize: '18px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          }}
          title="미니 패널로 줄이기"
        >—</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>통화 중 · {fmt(callSecs)}</div>
          <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>{currentAddress}</div>
          {mode === 'full' && destination && (
            <div style={{ fontSize: '11px', color: '#60A5FA', marginTop: '2px' }}>
              → {destination} ({routeType === 'fast' ? '빠른길' : '안심길'})
            </div>
          )}
        </div>
        <div style={{ width: '40px' }} />
      </div>

      {/* 중앙: 아바타 + 상태 + 자막 */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '0 24px',
      }}>
        {phase !== 'thinking' && (
          <div style={{
            position: 'absolute', width: '150px', height: '150px', borderRadius: '50%',
            border: `2px solid ${phaseColor}`, opacity: 0.35,
            animation: 'pulse-ring 1.4s ease-out infinite',
          }} />
        )}
        <div style={{
          width: '110px', height: '110px', borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, ${phaseColor}, ${phaseColor}66)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px',
          boxShadow: `0 0 40px ${phaseColor}55`, transition: 'all 0.4s ease', position: 'relative',
        }}>🤝</div>
        <div style={{ fontSize: '22px', fontWeight: 700 }}>AI 동행</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 18px',
          borderRadius: '999px', background: 'rgba(255,255,255,0.08)',
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%', background: phaseColor,
            animation: phase !== 'thinking' ? 'blink 1s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: '14px', color: '#CBD5E1' }}>{phaseLabel}</span>
        </div>

        {/* 대화 자막 */}
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
              background: 'rgba(255,255,255,0.1)', fontSize: '14px', color: '#CBD5E1',
              lineHeight: 1.5, alignSelf: 'flex-end', maxWidth: '90%',
            }}>
              <span style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>나</span>
              {lastUserText}
            </div>
          )}
        </div>

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
      </div>

      {/* 하단: 종료 버튼 */}
      <div style={{ textAlign: 'center', padding: '0 24px 52px', flexShrink: 0 }}>
        <button
          onClick={handleEnd}
          style={{
            width: '68px', height: '68px', borderRadius: '50%', border: 'none',
            background: '#EF4444', cursor: 'pointer', fontSize: '28px',
            boxShadow: '0 4px 24px rgba(239,68,68,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
          }}
        >📵</button>
        <div style={{ fontSize: '12px', color: '#64748B', marginTop: '8px' }}>통화 종료</div>
      </div>

      <style>{`
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:.4} 100%{transform:scale(1.6);opacity:0} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.2} }
      `}</style>
    </div>
  );
}
