import type { RouteCandidate, SafetyFeatureId } from '../types';

interface Props {
  type: 'safe' | 'fast';
  route: RouteCandidate;
  active: boolean;
  onClick: () => void;
  selectedFeatureIds?: SafetyFeatureId[];
  fastRoute?: RouteCandidate | null;
}

function formatTime(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

function formatDist(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatDelta(route: RouteCandidate, fastRoute?: RouteCandidate | null): string | null {
  if (!fastRoute) return null;
  const extraSeconds = route.totalTime - fastRoute.totalTime;
  const extraMeters = route.totalDistance - fastRoute.totalDistance;
  if (extraSeconds <= 30 && extraMeters <= 30) return null;
  return `+${Math.max(1, Math.ceil(extraSeconds / 60))}분 / +${formatDist(Math.max(0, extraMeters))} 안전 우선 경로`;
}

export default function RouteCard({ type, route, active, onClick, fastRoute }: Props) {
  const isSafe = type === 'safe';
  const accent = isSafe ? '#4F6F64' : '#D97745';
  const bgActive = isSafe ? '#EDF5F1' : '#FFF7ED';
  const label = isSafe ? '안심길' : '빠른길';
  const desc = isSafe ? '현재 구간에서 가장 안전한 경로로 안내합니다' : '가장 짧은 거리 기준';
  const delta = isSafe ? formatDelta(route, fastRoute) : null;

  return (
    <button
      onClick={onClick}
      style={{
        flex: '1 1 0',
        width: 'auto',
        minWidth: 0,
        border: `2px solid ${active ? accent : '#E5E7EB'}`,
        background: active ? bgActive : '#fff',
        borderRadius: 14,
        padding: '10px 10px 9px',
        textAlign: 'left',
        cursor: 'pointer',
        boxShadow: active ? '0 8px 22px rgba(79,111,100,0.16)' : 'none',
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: isSafe ? '#4F6F64' : '#E5E7EB',
            color: isSafe ? '#fff' : '#D97745',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {isSafe ? '안' : '빠'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#111827', whiteSpace: 'nowrap' }}>{label}</span>
            {isSafe && active && (
              <span style={{ border: '1.5px solid #4F6F64', borderRadius: 999, padding: '1px 6px', fontSize: 9, fontWeight: 900, color: '#4F6F64', whiteSpace: 'nowrap' }}>
                추천
              </span>
            )}
          </div>
          <div style={{ marginTop: 3, fontSize: 11, color: '#6B7280', lineHeight: 1.35 }}>{desc}</div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#020617', lineHeight: 1 }}>{formatTime(route.totalTime)}</div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#6B7280' }}>{formatDist(route.totalDistance)}</div>
        </div>
      </div>

      {isSafe && (
        <div style={{
          display: 'flex',
          gap: 12,
          marginTop: 9,
          paddingTop: 8,
          borderTop: '1px solid rgba(79,111,100,0.18)',
          color: '#4F6F64',
          fontSize: 11,
          fontWeight: 800,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}>
          <span>CCTV {route.cctvCount}</span>
          <span>안전거점 {route.tier2Count ?? route.safeSpotCount}</span>
        </div>
      )}

      {delta && (
        <div style={{ marginTop: 7, fontSize: 10, color: '#4F6F64', fontWeight: 800, lineHeight: 1.3 }}>
          {delta}
        </div>
      )}

      {!isSafe && (
        <div style={{ marginTop: 8, fontSize: 10, color: '#9CA3AF', textAlign: 'right' }}>T-map 기준</div>
      )}
    </button>
  );
}
