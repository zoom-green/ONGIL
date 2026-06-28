import { useState } from 'react';
import type { SafetyFeatureConfig, SafetyFeatureId } from '../types';
import { SAFETY_FEATURES } from '../utils/safetyFeatures';

interface SafetySettings {
  safeRouteEnabled: boolean;
  selectedFeatures: SafetyFeatureId[];
  shareIntervalMinutes: 2 | 4 | 8;
}

interface Props {
  initialSettings: SafetySettings;
  initialPhones: [string, string];
  onSave: (settings: SafetySettings, phones: [string, string]) => void;
  onClose: () => void;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function FeatureMiniIcon({ id, size = 14 }: { id: SafetyFeatureId; size?: number }) {
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

function FeatureBadge({ feature, active }: { feature: SafetyFeatureConfig; active: boolean }) {
  if (feature.iconFile) {
    return (
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: active ? feature.color : '#D1D5DB',
          border: '2px solid #fff',
          boxShadow: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <img
          src={`/icons/${feature.iconFile}`}
          width="24"
          height="24"
          style={{
            display: 'block',
            width: 24,
            height: 24,
            objectFit: 'cover',
            filter: active ? 'none' : 'grayscale(1)',
            opacity: active ? 1 : 0.45,
          }}
          alt=""
        />
      </span>
    );
  }

  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        background: active ? feature.color : '#D1D5DB',
        border: '2px solid #fff',
        boxShadow: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ color: '#fff', display: 'inline-flex' }}>
        <FeatureMiniIcon id={feature.id} size={16} />
      </span>
    </span>
  );
}

export default function SettingsModal({ initialSettings, initialPhones, onSave, onClose }: Props) {
  const [safeRouteEnabled, setSafeRouteEnabled] = useState(initialSettings.safeRouteEnabled);
  const [selectedFeatures, setSelectedFeatures] = useState<SafetyFeatureId[]>(initialSettings.selectedFeatures);
  const [shareIntervalMinutes, setShareIntervalMinutes] = useState<2 | 4 | 8>(initialSettings.shareIntervalMinutes);
  const [phones, setPhones] = useState<[string, string]>(initialPhones);

  const toggleFeature = (id: SafetyFeatureId) => {
    setSelectedFeatures((current) => {
      if (current.includes(id)) {
        if (current.length <= 1) return current;
        return current.filter((item) => item !== id);
      }
      return [...current, id];
    });
  };

  const save = () => {
    onSave({ safeRouteEnabled, selectedFeatures, shareIntervalMinutes }, phones);
  };

  return (
    <div
      onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 220,
        background: 'rgba(15,23,42,0.48)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}
    >
      <div style={{
        width: '100%',
        maxWidth: 520,
        maxHeight: '88dvh',
        overflowY: 'auto',
        background: '#fff',
        borderRadius: '18px 18px 0 0',
        boxShadow: '0 -12px 40px rgba(15,23,42,0.22)',
        padding: '18px 18px 28px',
        fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#0F172A' }}>설정</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>안심길과 보호자 위치 공유를 관리해요</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', border: 0, background: '#F1F5F9', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <section style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>안심길</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>켜져 있을 때만 선택한 요소로 안심길을 계산해요</div>
            </div>
            <button
              onClick={() => setSafeRouteEnabled((value) => !value)}
              style={{
                marginLeft: 'auto',
                border: 0,
                borderRadius: 999,
                width: 58,
                height: 32,
                background: safeRouteEnabled ? '#2563EB' : '#CBD5E1',
                padding: 3,
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'block', width: 26, height: 26, borderRadius: '50%', background: '#fff', transform: `translateX(${safeRouteEnabled ? 26 : 0}px)`, transition: 'transform .15s' }} />
            </button>
          </div>

          {safeRouteEnabled && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 8 }}>
                안심길 구성요소 {selectedFeatures.length}개 선택
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {SAFETY_FEATURES.map((feature) => {
                  const active = selectedFeatures.includes(feature.id);
                  return (
                    <button
                      key={feature.id}
                      onClick={() => toggleFeature(feature.id)}
                      style={{
                        minHeight: 42,
                        borderRadius: 10,
                        border: `1.5px solid ${active ? feature.color : '#E2E8F0'}`,
                        background: active ? `${feature.color}14` : '#fff',
                        color: active ? feature.color : '#475569',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: '9px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <FeatureBadge feature={feature} active={active} />
                      <span>{feature.label}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>최소 1개는 항상 선택되어 있어야 해요</div>
            </div>
          )}
        </section>

        <section style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 10 }}>보호자 연락처</div>
          {[0, 1].map((index) => (
            <input
              key={index}
              value={phones[index as 0 | 1]}
              onChange={(event) => {
                const next: [string, string] = [phones[0], phones[1]];
                next[index as 0 | 1] = formatPhone(event.target.value);
                setPhones(next);
              }}
              type="tel"
              inputMode="numeric"
              placeholder={index === 0 ? '보호자 1 010-0000-0000' : '보호자 2 010-0000-0000'}
              style={{
                width: '100%',
                height: 44,
                border: '1.5px solid #E2E8F0',
                borderRadius: 10,
                padding: '0 12px',
                fontSize: 14,
                outline: 'none',
                marginTop: index === 0 ? 0 : 8,
              }}
            />
          ))}
        </section>

        <section style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 10 }}>위치 공유 알림</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {([2, 4, 8] as const).map((minute) => (
              <button
                key={minute}
                onClick={() => setShareIntervalMinutes(minute)}
                style={{
                  height: 42,
                  borderRadius: 10,
                  border: `1.5px solid ${shareIntervalMinutes === minute ? '#2563EB' : '#E2E8F0'}`,
                  background: shareIntervalMinutes === minute ? '#EFF6FF' : '#fff',
                  color: shareIntervalMinutes === minute ? '#2563EB' : '#475569',
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                {minute}분
              </button>
            ))}
          </div>
        </section>

        <button
          onClick={save}
          style={{
            width: '100%',
            height: 48,
            borderRadius: 12,
            border: 0,
            background: '#1E3A5F',
            color: '#fff',
            fontSize: 15,
            fontWeight: 900,
            cursor: 'pointer',
          }}
        >
          저장하기
        </button>
      </div>
    </div>
  );
}
