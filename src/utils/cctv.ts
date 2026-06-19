import Papa from 'papaparse';
import type { CctvPoint } from '../types';
import { GANGNEUNG_CCTV_FALLBACK } from '../data/cctvFallback';

let cached: CctvPoint[] | null = null;

export async function loadCctvData(): Promise<CctvPoint[]> {
  if (cached) return cached;

  let csvPoints: CctvPoint[] = [];

  try {
    const res = await fetch('/data/cctv_gangneung.csv');
    if (res.ok) {
      const text = await res.text();
      await new Promise<void>((resolve) => {
        Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => {
            for (const row of result.data) {
              let lat = parseFloat(
                row['위도'] || row['lat'] || row['latitude'] || row['WGS84위도'] || ''
              );
              let lng = parseFloat(
                row['경도'] || row['lng'] || row['longitude'] || row['WGS84경도'] || ''
              );

              // 인코딩 문제로 컬럼명이 깨진 경우: WGS84로 시작하는 컬럼 자동 탐지
              if (isNaN(lat) || isNaN(lng)) {
                for (const key of Object.keys(row)) {
                  if (!key.startsWith('WGS84')) continue;
                  const val = parseFloat(row[key]);
                  if (isNaN(val)) continue;
                  if (val >= 33 && val <= 40) lat = val;        // 한국 위도 범위
                  else if (val >= 124 && val <= 132) lng = val; // 한국 경도 범위
                }
              }

              if (!isNaN(lat) && !isNaN(lng) && lat > 37 && lat < 38.5 && lng > 128 && lng < 130) {
                csvPoints.push({ lat, lng });
              }
            }
            resolve();
          },
        });
      });
    }
  } catch {
    // CSV 로드 실패 시 fallback 사용
  }

  const base: CctvPoint[] = csvPoints.length >= 5 ? [...csvPoints] : [...GANGNEUNG_CCTV_FALLBACK];

  if (csvPoints.length >= 5) {
    for (const fb of GANGNEUNG_CCTV_FALLBACK) {
      const tooClose = base.some(
        (p) => Math.abs(p.lat - fb.lat) < 0.0002 && Math.abs(p.lng - fb.lng) < 0.0002
      );
      if (!tooClose) base.push(fb);
    }
  }

  cached = base;
  return cached;
}
