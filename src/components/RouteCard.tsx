import type { RouteCandidate, SafetyFeatureId } from '../types';
import { getSafetyFeature } from '../utils/safetyFeatures';

interface Props {
  type: 'safe' | 'fast';
  route: RouteCandidate;
  active: boolean;
  onClick: () => void;
  selectedFeatureIds?: SafetyFeatureId[];
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

function getFeatureCount(route: RouteCandidate, id: SafetyFeatureId): number {
  const count = route.featureCounts?.[id];
  if (typeof count === 'number') return count;
  if (id === 'cctv') return route.cctvCount;
  return 0;
}

function FeatureMiniIcon({ id, size = 12 }: { id: SafetyFeatureId; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (id === 'cctv') return <svg {...common}><path d="M4 11a8 8 0 0 1 16 0v3H4z" /><path d="M7 14v3h10v-3" /><circle cx="12" cy="13" r="2.2" /><path d="M12 17v3" /></svg>;
  if (id === 'food') return <svg {...common}><path d="M7 3v8" /><path d="M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3" /><path d="M7 11v10" /><path d="M16 3c2 1.8 3 4 3 6.5 0 2-1.1 3.5-3 3.5h-1V3z" /><path d="M16 13v8" /></svg>;
  if (id === 'convenience') return <svg {...common}><path d="M4 9h16v11H4z" /><path d="M7 20v-6h10v6" /><path d="M8 6h8l2 3H6z" /><text x="12" y="13" textAnchor="middle" fontSize="6.2" fill="currentColor" stroke="none" fontWeight="900">24</text></svg>;
  if (id === 'police') return <svg {...common}><path d="M12 3l7 3v5c0 4.5-3 7.8-7 10-4-2.2-7-5.5-7-10V6l7-3z" /><path d="M8.5 10.5l2.4 2.4 4.8-5" /><text x="12" y="18" textAnchor="middle" fontSize="5.2" fill="currentColor" stroke="none" fontWeight="900">112</text></svg>;
  if (id === 'fire') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><text x="12" y="13.5" textAnchor="middle" fontSize="10" fill="currentColor" fontWeight="900" fontStyle="italic">119</text><path d="M5.5 17.2h4.5M11.2 17.2h4.5M16.6 17.2h2.4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /><path d="M4.8 20h4.3M10.5 20h4.3M16 20h3.2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>;
  if (id === 'light') return <svg {...common}><path d="M8 21h7" /><path d="M9.5 18h4" /><path d="M10 18V7a4 4 0 0 1 8 0v3" /><path d="M17 10h3" /><path d="M14.5 13h7" /><path d="M18 13v2.5" /></svg>;
  if (id === 'childSafeHouse') return <svg {...common}><path d="M4 11.5L12 4l8 7.5" /><path d="M6.5 10.5V20h11v-9.5" /><path d="M10 20v-5h4v5" /></svg>;
  if (id === 'medical') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></svg>;
  if (id === 'toilet') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="8" r="1.5" fill="#fff" /><circle cx="16" cy="8" r="1.5" fill="#fff" /><path d="M7 11h2l1 6H6z" fill="#fff" /><path d="M15 11h2l1 6h-4z" fill="#fff" /><path d="M12 6v12" stroke="#fff" strokeWidth="1.3" /></svg>;
  return <svg {...common}><path d="M12 4v10" /><path d="M12 18h.01" /></svg>;
}

export default function RouteCard({ type, route, active, onClick, selectedFeatureIds = [] }: Props) {
  const isSafe = type === 'safe';
  const accent = isSafe ? '#4F6F64' : '#D97745';
  const bgActive = isSafe ? '#EDF5F1' : '#FFF7ED';
  const label = isSafe ? '안심 길' : '빠른 길';
  const desc = isSafe ? '선택한 안전 요소를 반영한 길' : '가장 빠른 거리 기준';
  const safeFeatures = selectedFeatureIds.map((id) => ({
    ...getSafetyFeature(id),
    count: getFeatureCount(route, id),
  }));

  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        width: '100%',
        border: `2px solid ${active ? accent : '#E5E7EB'}`,
        background: active ? bgActive : '#fff',
        borderRadius: 18,
        padding: '12px 12px 11px',
        textAlign: 'left',
        cursor: 'pointer',
        boxShadow: active ? '0 8px 22px rgba(79,111,100,0.16)' : 'none',
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: isSafe ? '#4F6F64' : '#E5E7EB',
            color: isSafe ? '#fff' : '#D97745',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {isSafe ? '🛡' : '⚡'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: '#111827' }}>{label}</span>
            {isSafe && active && (
              <span style={{ border: '1.5px solid #4F6F64', borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 900, color: '#4F6F64' }}>
                추천
              </span>
            )}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#6B7280', lineHeight: 1.35 }}>{desc}</div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#020617', lineHeight: 1 }}>{formatTime(route.totalTime)}</div>
          <div style={{ marginTop: 5, fontSize: 12, color: '#6B7280' }}>{formatDist(route.totalDistance)}</div>
        </div>
      </div>

      {isSafe && safeFeatures.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 16,
          marginTop: 11,
          paddingTop: 10,
          borderTop: '1px solid rgba(79,111,100,0.18)',
          overflowX: 'auto',
          overflowY: 'hidden',
          whiteSpace: 'nowrap',
        }}>
          {safeFeatures.map((feature) => (
            <div key={feature.id} style={{ minWidth: 44, flex: '0 0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    width: 17,
                    height: 17,
                    borderRadius: 4,
                    background: feature.color,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ color: '#fff', display: 'inline-flex' }}>
                    <FeatureMiniIcon id={feature.id} size={10} />
                  </span>
                </span>
                <span style={{ fontSize: 15, fontWeight: 900, color: feature.color, lineHeight: 1 }}>{feature.count}</span>
              </div>
              <div style={{ marginTop: 3, fontSize: 11, color: feature.color, whiteSpace: 'nowrap' }}>
                {feature.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isSafe && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#9CA3AF', textAlign: 'right' }}>T-map 기준</div>
      )}
    </button>
  );
}
