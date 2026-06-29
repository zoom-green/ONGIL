import { useState } from 'react';

interface SafetySettings {
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

export default function SettingsModal({ initialSettings, initialPhones, onSave, onClose }: Props) {
  const [shareIntervalMinutes, setShareIntervalMinutes] = useState<2 | 4 | 8>(initialSettings.shareIntervalMinutes);
  const [phones, setPhones] = useState<[string, string]>(initialPhones);

  const save = () => {
    onSave({ shareIntervalMinutes }, phones);
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
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>보호자 연락처와 위치 공유 주기를 관리해요</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', border: 0, background: '#F1F5F9', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 18 }}>x</button>
        </div>

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
                boxSizing: 'border-box',
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
