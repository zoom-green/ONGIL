/**
 * CompanionMiniPanel — AI 동행 하단 미니 패널 UI (순수 표시 컴포넌트).
 * 지도와 공존하는 하단 슬롯에 표시되며, 패널 전체 탭 또는 ↑ 버튼으로 풀스크린 전환.
 * useAiCompanion 훅은 CompanionWrapper에서 관리.
 */
import type { Phase } from '../hooks/useAiCompanion';

interface Props {
  phase: Phase;
  callSecs: number;
  micError: string | null;
  lastAIText: string;
  geminiError: string | null;
  callStarted: boolean;
  destination?: string;
  handleStartCall: () => void;
  handleEnd: () => void;
  fmt: (secs: number) => string;
  onExpand: () => void;
}

export default function CompanionMiniPanel({
  phase, callSecs, micError, lastAIText, geminiError,
  callStarted, destination, handleStartCall, handleEnd, fmt, onExpand,
}: Props) {
  const phaseColor = phase === 'speaking' ? '#7C3AED' : phase === 'thinking' ? '#60A5FA' : '#34D399';
  const phaseLabel = phase === 'speaking' ? '말하는 중' : phase === 'thinking' ? '생각 중' : '듣는 중';

  return (
    <div style={{
      background: '#0f0f1a',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      flexShrink: 0,
      fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
    }}>
      {!callStarted ? (
        /* 전화 받기 상태 */
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', gap: '12px',
        }}>
          <div
            onClick={onExpand}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, cursor: 'pointer' }}
          >
            <div style={{ fontSize: '28px', animation: 'ring 1s ease-in-out infinite' }}>📞</div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>엄마가 전화했어요</div>
              {destination && (
                <div style={{ fontSize: '11px', color: '#60A5FA', marginTop: '2px' }}>→ {destination}</div>
              )}
            </div>
          </div>
          <button
            onClick={handleStartCall}
            style={{
              padding: '10px 20px', borderRadius: '50px', border: 'none',
              background: '#22C55E', color: '#fff', fontSize: '14px', fontWeight: 800,
              cursor: 'pointer', flexShrink: 0,
              fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
            }}
          >받기</button>
        </div>
      ) : (
        /* 통화 중 상태 — 패널 전체 탭 시 풀스크린으로 전환 */
        <div onClick={onExpand} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <div style={{ padding: '12px 16px 14px' }}>
            {/* 상단 행 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: (lastAIText || micError || geminiError) ? '8px' : '0',
            }}>
              <span style={{ fontSize: '16px' }}>🤝</span>
              <span style={{ fontSize: '13px', color: '#A78BFA', fontWeight: 700 }}>AI 동행 중</span>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '3px 8px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)',
              }}>
                <div style={{
                  width: '6px', height: '6px', borderRadius: '50%', background: phaseColor,
                  animation: 'blink-mini 1s ease-in-out infinite',
                }} />
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>{phaseLabel}</span>
              </div>
              <span style={{ fontSize: '12px', color: '#64748B', marginLeft: 'auto' }}>{fmt(callSecs)}</span>
              {/* 확대 버튼 */}
              <button
                onClick={(e) => { e.stopPropagation(); onExpand(); }}
                style={{
                  width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                  background: 'rgba(255,255,255,0.12)', cursor: 'pointer', fontSize: '14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', flexShrink: 0,
                }}
                title="풀스크린으로 전환"
              >↑</button>
              {/* 종료 버튼 */}
              <button
                onClick={(e) => { e.stopPropagation(); handleEnd(); }}
                style={{
                  width: '36px', height: '36px', borderRadius: '50%', border: 'none',
                  background: '#EF4444', cursor: 'pointer', fontSize: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >📵</button>
            </div>

            {/* AI 자막 */}
            {(lastAIText || micError || geminiError) && (
              <div style={{
                padding: '8px 12px', borderRadius: '10px',
                background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)',
                fontSize: '13px', color: '#E2E8F0', lineHeight: 1.5,
              }}>
                {micError
                  ? <span style={{ color: '#FCA5A5' }}>🎤 {micError}</span>
                  : geminiError
                    ? <span style={{ color: '#FCD34D' }}>⚠️ {geminiError}</span>
                    : lastAIText
                }
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes ring { 0%,100%{transform:rotate(-15deg)} 50%{transform:rotate(15deg)} }
        @keyframes blink-mini { 0%,100%{opacity:1} 50%{opacity:.2} }
      `}</style>
    </div>
  );
}
