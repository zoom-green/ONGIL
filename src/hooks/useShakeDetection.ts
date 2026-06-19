import { useEffect, useRef } from 'react';

// acceleration (중력 제외) 기준: 갤럭시에서 강한 흔들기 ~15-25 m/s²
const ACCEL_THRESHOLD = 15;
// accelerationIncludingGravity 기준 fallback: 중력 9.8 포함 → 더 높게 설정
const GRAVITY_THRESHOLD = 25;
const COUNT_REQUIRED = 3;  // 3회 연속 흔들기 필요 (오감지 방지)
const SHAKE_WINDOW = 1500; // ms — 1.5초 안에 COUNT_REQUIRED회 감지
const COOLDOWN = 6000;     // ms — 트리거 후 재발동 방지
const DEBOUNCE = 150;      // ms — 개별 피크 간 최소 간격

export function useShakeDetection(onShake: () => void, enabled: boolean) {
  const countRef = useRef(0);
  const lastPeakTimeRef = useRef(0);   // 마지막 피크 시각 (디바운스)
  const firstPeakTimeRef = useRef(0);  // 현재 연속 시퀀스 시작 시각 (윈도우)
  const lockedRef = useRef(false);
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;

  useEffect(() => {
    if (!enabled) return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.acceleration;
      const accG = e.accelerationIncludingGravity;

      let mag: number;
      let threshold: number;

      // acceleration (중력 제외) 가용 시 우선 사용 — 더 정확한 순수 흔들기 감지
      if (acc && (acc.x !== null || acc.y !== null || acc.z !== null)) {
        mag = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
        threshold = ACCEL_THRESHOLD;
      } else if (accG) {
        mag = Math.sqrt((accG.x ?? 0) ** 2 + (accG.y ?? 0) ** 2 + (accG.z ?? 0) ** 2);
        threshold = GRAVITY_THRESHOLD;
      } else {
        return;
      }

      if (mag <= threshold) return;

      const now = Date.now();

      // 디바운스: 너무 빠른 연속 피크 무시
      if (now - lastPeakTimeRef.current < DEBOUNCE) return;
      lastPeakTimeRef.current = now;

      // 윈도우 초과 시 카운트 리셋
      if (now - firstPeakTimeRef.current > SHAKE_WINDOW) {
        countRef.current = 0;
        firstPeakTimeRef.current = now;
      }

      countRef.current += 1;

      if (countRef.current >= COUNT_REQUIRED && !lockedRef.current) {
        lockedRef.current = true;
        countRef.current = 0;
        firstPeakTimeRef.current = 0;
        onShakeRef.current();
        setTimeout(() => { lockedRef.current = false; }, COOLDOWN);
      }
    };

    // iOS 13+는 DeviceMotionEvent 권한 요청 필요
    const setup = async () => {
      const DM = DeviceMotionEvent as any;
      if (typeof DM.requestPermission === 'function') {
        try {
          const result = await DM.requestPermission();
          if (result === 'granted') {
            window.addEventListener('devicemotion', handleMotion);
          }
        } catch {
          // 권한 거부 — 무시
        }
      } else {
        window.addEventListener('devicemotion', handleMotion);
      }
    };

    setup();
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [enabled]);
}
