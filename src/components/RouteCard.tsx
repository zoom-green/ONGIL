import type { RouteCandidate } from '../types';

interface Props {
  type: 'safe' | 'fast';
  route: RouteCandidate;
  active: boolean;
  onClick: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

function formatDist(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export default function RouteCard({ type, route, active, onClick }: Props) {
  const isSafe = type === 'safe';

  const accent = isSafe ? '#3B82F6' : '#F97316';
  const bgActive = isSafe ? '#EFF6FF' : '#FFF7ED';
  const label = isSafe ? '안심길' : '빠른길';
  const emoji = isSafe ? '🛡️' : '⚡';
  const desc = isSafe ? 'CCTV·안전 거점 최다 경로' : '최단 거리 경로';

  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        padding: '14px 12px',
        borderRadius: '16px',
        border: `2px solid ${active ? accent : '#E5E7EB'}`,
        background: active ? bgActive : '#fff',
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: active ? `0 2px 12px ${accent}33` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <span style={{ fontSize: '18px' }}>{emoji}</span>
        <span style={{ fontSize: '15px', fontWeight: 700, color: active ? accent : '#374151' }}>
          {label}
        </span>
        {active && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '11px',
              background: accent,
              color: '#fff',
              borderRadius: '999px',
              padding: '2px 8px',
              fontWeight: 600,
            }}
          >
            선택됨
          </span>
        )}
      </div>

      <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>{desc}</div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>
            {formatTime(route.totalTime)}
          </div>
          <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{formatDist(route.totalDistance)}</div>
        </div>

        {isSafe && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#2563EB' }}>
                {route.cctvCount}
              </div>
              <div style={{ fontSize: '10px', color: '#6B7280' }}>CCTV</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#059669' }}>
                {route.safeSpotCount}
              </div>
              <div style={{ fontSize: '10px', color: '#6B7280' }}>안전거점</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
