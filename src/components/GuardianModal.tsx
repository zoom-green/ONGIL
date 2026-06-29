import { useState } from 'react';

interface Props {
  initialPhones: [string, string];
  onSave: (phones: [string, string]) => void;
  onClose: () => void;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function isValid(phone: string): boolean {
  return /^01[016789]-\d{3,4}-\d{4}$/.test(phone);
}

export default function GuardianModal({ initialPhones, onSave, onClose }: Props) {
  const [inputs, setInputs] = useState<[string, string]>(initialPhones);

  const handleChange = (idx: 0 | 1, raw: string) => {
    const formatted = formatPhone(raw);
    const next: [string, string] = [inputs[0], inputs[1]];
    next[idx] = formatted;
    setInputs(next);
  };

  const handleClear = (idx: 0 | 1) => {
    const next: [string, string] = [inputs[0], inputs[1]];
    next[idx] = '';
    setInputs(next);
  };

  const handleSave = () => {
    onSave([inputs[0].trim(), inputs[1].trim()]);
  };

  const canSave = inputs[0].trim() !== '' || inputs[1].trim() !== '';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff',
        borderRadius: '24px 24px 0 0',
        padding: '8px 0 0',
        width: '100%', maxWidth: '480px',
        fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
        boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
      }}>
        {/* 드래그 핸들 */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: '12px' }}>
          <div style={{ width: '40px', height: '4px', borderRadius: '2px', background: '#E5E7EB' }} />
        </div>

        <div style={{ padding: '0 24px 32px' }}>
          {/* 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '12px',
              background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px',
            }}>
              🛡️
            </div>
            <div>
              <div style={{ fontSize: '17px', fontWeight: 800, color: '#1E3A5F' }}>보호자 연락처</div>
              <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '1px' }}>최대 2명 등록 가능</div>
            </div>
          </div>

          <div style={{
            background: '#F8FAFC', borderRadius: '12px',
            padding: '12px 14px', marginBottom: '20px',
            fontSize: '13px', color: '#64748B', lineHeight: 1.6,
          }}>
            SOS 버튼을 누르면<br />
            현재 위치가 담긴 위험 알림이 즉시 전송돼요.
          </div>

          {/* 보호자 1 */}
          <PhoneInput
            label="보호자 1"
            required
            value={inputs[0]}
            onChange={(v) => handleChange(0, v)}
            onClear={() => handleClear(0)}
            onEnter={handleSave}
          />

          {/* 보호자 2 */}
          <div style={{ marginTop: '12px' }}>
            <PhoneInput
              label="보호자 2"
              value={inputs[1]}
              onChange={(v) => handleChange(1, v)}
              onClear={() => handleClear(1)}
              onEnter={handleSave}
            />
          </div>

          {/* 버튼 */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '15px', borderRadius: '14px',
                border: '1.5px solid #E5E7EB', background: '#F9FAFB',
                fontSize: '15px', cursor: 'pointer', color: '#374151', fontWeight: 600,
                fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
              }}
            >
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              style={{
                flex: 2, padding: '15px', borderRadius: '14px',
                border: 'none',
                background: canSave
                  ? 'linear-gradient(135deg, #1E3A5F, #2563EB)'
                  : '#E5E7EB',
                color: canSave ? '#fff' : '#9CA3AF',
                fontSize: '15px', fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed',
                fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                transition: 'all 0.15s',
              }}
            >
              저장하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PhoneInputProps {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  onEnter: () => void;
}

function PhoneInput({ label, required, value, onChange, onClear, onEnter }: PhoneInputProps) {
  const [focused, setFocused] = useState(false);
  const valid = isValid(value);
  const hasValue = value.length > 0;

  const borderColor = focused
    ? (hasValue ? (valid ? '#10B981' : '#3B82F6') : '#3B82F6')
    : (hasValue ? (valid ? '#10B981' : '#E5E7EB') : '#E5E7EB');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', color: '#374151', fontWeight: 600 }}>{label}</span>
        {!required && (
          <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 400 }}>(선택)</span>
        )}
        {hasValue && valid && (
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#10B981', fontWeight: 600 }}>
            ✓ 등록 가능
          </span>
        )}
        {hasValue && !valid && (
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#F59E0B', fontWeight: 600 }}>
            번호 확인 필요
          </span>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type="tel"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
          placeholder="010-0000-0000"
          style={{
            width: '100%', padding: '14px 44px 14px 16px',
            fontSize: '16px', border: `2px solid ${borderColor}`,
            borderRadius: '12px', outline: 'none', boxSizing: 'border-box',
            fontFamily: "'Apple SD Gothic Neo','Noto Sans KR',sans-serif",
            transition: 'border-color 0.15s',
            background: '#fff',
          }}
        />
        {hasValue && (
          <button
            onClick={onClear}
            style={{
              position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
              width: '24px', height: '24px', borderRadius: '50%',
              background: '#E5E7EB', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', color: '#6B7280', lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
