import { useState, useEffect, useRef } from 'react';

export interface UserLocation {
  lat: number;
  lng: number;
  heading: number | null; // 0-360, 북쪽 기준 시계방향 (나침반 또는 GPS 방향)
}

export function useUserLocation(): {
  location: UserLocation | null;
  error: string | null;
  ready: boolean;
} {
  const [gpsPos, setGpsPos] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  // GPS 위치 추적 (watchPosition)
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('이 브라우저는 위치 서비스를 지원하지 않습니다.');
      setReady(true);
      return;
    }

    const markReady = () => {
      if (!readyRef.current) {
        readyRef.current = true;
        setReady(true);
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading, // 이동 중에만 값 있음
        });
        markReady();
        setError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError('위치 권한이 거부됐습니다. 브라우저 설정에서 허용해주세요.');
        }
        markReady();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 기기 나침반 (DeviceOrientationEvent) — 정지 상태에서도 방향 제공
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      // iOS: webkitCompassHeading (0-360, 북=0, 시계방향)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iosHeading = (e as any).webkitCompassHeading as number | undefined;
      if (iosHeading != null && !isNaN(iosHeading)) {
        setCompassHeading(iosHeading);
        return;
      }
      // Android: absolute=true + alpha (반시계, 북=0) → 시계방향으로 변환
      if (e.absolute && e.alpha != null) {
        setCompassHeading((360 - e.alpha) % 360);
      }
    };

    // deviceorientationabsolute: 절대 북극 기준 (Android Chrome 지원)
    window.addEventListener('deviceorientationabsolute', handleOrientation as EventListener, true);
    // deviceorientation: iOS fallback
    window.addEventListener('deviceorientation', handleOrientation as EventListener, true);

    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation as EventListener, true);
      window.removeEventListener('deviceorientation', handleOrientation as EventListener, true);
    };
  }, []);

  const location: UserLocation | null = gpsPos
    ? {
        lat: gpsPos.lat,
        lng: gpsPos.lng,
        // 나침반 우선(정지 상태도 동작), 없으면 GPS 이동 방향
        heading: compassHeading ?? gpsPos.heading,
      }
    : null;

  return { location, error, ready };
}
