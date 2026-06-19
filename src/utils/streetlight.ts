import type { StreetlightPoint } from '../types';

let cached: StreetlightPoint[] | null = null;

interface RawStreetlight {
  '좌표(위도)': string;
  '좌표(경도)': string;
}

export async function loadStreetlightData(): Promise<StreetlightPoint[]> {
  if (cached) return cached;

  const result: StreetlightPoint[] = [];

  try {
    const res = await fetch('/data/streetlights_gangneung.json');
    if (res.ok) {
      const data: RawStreetlight[] = await res.json();
      for (const row of data) {
        const lat = parseFloat(row['좌표(위도)']);
        const lng = parseFloat(row['좌표(경도)']);
        if (!isNaN(lat) && !isNaN(lng) && lat > 37 && lat < 38.5 && lng > 128 && lng < 130) {
          result.push({ lat, lng });
        }
      }
    }
  } catch {
    // 로드 실패 시 빈 배열 반환
  }

  cached = result;
  return cached;
}
