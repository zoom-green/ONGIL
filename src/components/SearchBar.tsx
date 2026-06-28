import { useState, useRef, useEffect, useCallback } from 'react';
import type { Place } from '../types';
import { searchTmapPOI } from '../utils/tmap';

interface Props {
  onSelect: (place: Place) => void;
  placeholder?: string;
  defaultValue?: string;
  userPosition?: { lat: number; lng: number } | null;
}

// distance result extends Place with optional distanceM for display
interface SearchResult extends Place {
  distanceM?: number;
}

const GANGNEUNG = { lat: 37.7519, lng: 128.8761 };

function formatDist(m: number): string {
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export default function SearchBar({
  onSelect,
  placeholder = '장소 또는 주소 검색',
  defaultValue = '',
  userPosition,
}: Props) {
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const psRef = useRef<kakao.maps.services.Places | null>(null);
  const gcRef = useRef<kakao.maps.services.Geocoder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEnterRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof kakao !== 'undefined') {
      psRef.current = new kakao.maps.services.Places();
      gcRef.current = new kakao.maps.services.Geocoder();
    }
  }, []);

  // close dropdown when clicking outside the component
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const search = useCallback((text: string) => {
    if (!text.trim()) { setResults([]); setOpen(false); setIsLoading(false); return; }

    setIsLoading(true);
    const merged: SearchResult[] = [];
    const seen = new Set<string>();
    let doneCount = 0;
    const TOTAL = 4; // ① 거리순 로컬 ② 전국 관련도 ③ 주소 ④ T-map POI

    const center = userPosition ?? GANGNEUNG;

    const addPlace = (p: SearchResult) => {
      const key = `${p.position.lat.toFixed(4)},${p.position.lng.toFixed(4)}`;
      if (!seen.has(key)) { seen.add(key); merged.push(p); }
    };

    const done = () => {
      doneCount++;
      if (doneCount >= TOTAL) {
        setIsLoading(false);
        // sort by distance when available, then keep insertion order
        const sorted = [...merged].sort((a, b) => {
          if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
          if (a.distanceM != null) return -1;
          if (b.distanceM != null) return 1;
          return 0;
        });
        const final = sorted.slice(0, 8);
        setResults(final);
        setOpen(final.length > 0);
        if (pendingEnterRef.current && final.length > 0) {
          pendingEnterRef.current = false;
          setQuery(final[0].name);
          setResults([]);
          setOpen(false);
          onSelect({ name: final[0].name, address: final[0].address, position: final[0].position });
        }
      }
    };

    // ① 거리순 로컬 검색: 사용자 위치 기준 20km 반경, 가까운 순
    if (psRef.current) {
      psRef.current.keywordSearch(
        text,
        (res, status) => {
          if (status === kakao.maps.services.Status.OK) {
            res.forEach((r) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const dist = (r as any).distance as string | undefined;
              addPlace({
                name: r.place_name,
                address: r.road_address_name || r.address_name,
                position: { lat: parseFloat(r.y), lng: parseFloat(r.x) },
                distanceM: dist ? parseInt(dist, 10) : undefined,
              });
            });
          }
          done();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ location: new kakao.maps.LatLng(center.lat, center.lng), radius: 20000, size: 8, sort: 1 } as any)
      );
    } else { done(); }

    // ② 전국 관련도 검색: 고유명사·오타 보완
    if (psRef.current) {
      psRef.current.keywordSearch(
        text,
        (res, status) => {
          if (status === kakao.maps.services.Status.OK) {
            res.slice(0, 5).forEach((r) =>
              addPlace({
                name: r.place_name,
                address: r.road_address_name || r.address_name,
                position: { lat: parseFloat(r.y), lng: parseFloat(r.x) },
              })
            );
          }
          done();
        },
        { size: 6 }
      );
    } else { done(); }

    // ③ 주소 검색
    if (gcRef.current) {
      gcRef.current.addressSearch(text, (res, status) => {
        if (status === kakao.maps.services.Status.OK) {
          res.slice(0, 3).forEach((r) =>
            addPlace({
              name: r.road_address?.address_name || r.address_name,
              address: r.address_name,
              position: { lat: parseFloat(r.y), lng: parseFloat(r.x) },
            })
          );
        }
        done();
      });
    } else { done(); }

    // ④ T-map POI: 강릉 바운딩박스 내 소규모 장소·골목 보완
    searchTmapPOI(text)
      .then((places) => { places.forEach(addPlace); done(); })
      .catch(() => done());
  }, [userPosition, onSelect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!val.trim()) { setResults([]); setOpen(false); setIsLoading(false); return; }
    timerRef.current = setTimeout(() => search(val), 250);
  };

  const handleSelect = (place: SearchResult) => {
    setQuery(place.name);
    setResults([]);
    setOpen(false);
    onSelect({ name: place.name, address: place.address, position: place.position });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (results.length > 0) {
      handleSelect(results[0]);
    } else if (query.trim()) {
      pendingEnterRef.current = true;
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            width: '100%', padding: '9px 34px 9px 12px', fontSize: '14px',
            border: '1.5px solid #E5E7EB', borderRadius: '10px', outline: 'none',
            boxSizing: 'border-box', background: '#F9FAFB', color: '#111827',
          }}
        />
        {/* 로딩 스피너 / 검색 아이콘 */}
        <div style={{
          position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none',
        }}>
          {isLoading ? (
            <div style={{
              width: '16px', height: '16px',
              border: '2px solid #E5E7EB', borderTop: '2px solid #3B82F6',
              borderRadius: '50%', animation: 'spin 0.7s linear infinite',
            }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          )}
        </div>
      </div>

      {open && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
          border: '1px solid #E5E7EB', borderRadius: '10px', marginTop: '4px',
          padding: 0, listStyle: 'none', zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          maxHeight: '280px', overflowY: 'auto',
        }}>
          {results.length === 0 ? (
            <li style={{ padding: '12px 13px', fontSize: '12px', color: '#9CA3AF', textAlign: 'center' }}>
              검색 결과 없음
            </li>
          ) : results.map((place, i) => (
            <li
              key={i}
              onMouseDown={() => handleSelect(place)}
              style={{
                padding: '9px 13px', cursor: 'pointer',
                borderBottom: i < results.length - 1 ? '1px solid #F3F4F6' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {place.name}
                </div>
                {place.address && place.address !== place.name && (
                  <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {place.address}
                  </div>
                )}
              </div>
              {place.distanceM != null && (
                <div style={{ fontSize: '11px', color: '#3B82F6', fontWeight: 600, marginLeft: '8px', flexShrink: 0 }}>
                  {formatDist(place.distanceM)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
