import { useState, useRef, useEffect, useCallback } from 'react';
import type { Place } from '../types';
import { searchTmapPOI } from '../utils/tmap';

interface Props {
  onSelect: (place: Place) => void;
  placeholder?: string;
  defaultValue?: string;
}

const GANGNEUNG = { lat: 37.7519, lng: 128.8761 };

export default function SearchBar({ onSelect, placeholder = '장소 또는 주소 검색', defaultValue = '' }: Props) {
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);

  const psRef = useRef<kakao.maps.services.Places | null>(null);
  const gcRef = useRef<kakao.maps.services.Geocoder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEnterRef = useRef(false); // 엔터 눌렀는데 결과 아직 없을 때 대기 플래그

  useEffect(() => {
    if (typeof kakao !== 'undefined') {
      psRef.current = new kakao.maps.services.Places();
      gcRef.current = new kakao.maps.services.Geocoder();
    }
  }, []);

  const search = useCallback((text: string) => {
    if (!text.trim()) { setResults([]); setOpen(false); return; }

    const merged: Place[] = [];
    const seen = new Set<string>();
    let doneCount = 0;
    const TOTAL = 4; // ① 로컬 장소 ② 전국 장소 ③ 주소 ④ T-map POI

    const toPlace = (r: kakao.maps.services.PlacesSearchResult): Place => ({
      name: r.place_name,
      address: r.road_address_name || r.address_name,
      position: { lat: parseFloat(r.y), lng: parseFloat(r.x) },
    });

    const addPlace = (p: Place) => {
      const key = `${p.position.lat.toFixed(4)},${p.position.lng.toFixed(4)}`;
      if (!seen.has(key)) { seen.add(key); merged.push(p); }
    };

    const done = () => {
      doneCount++;
      if (doneCount >= TOTAL) {
        const final = merged.slice(0, 8);
        setResults(final);
        setOpen(final.length > 0);
        // 엔터를 먼저 눌렀던 경우 첫 번째 결과 자동 선택
        if (pendingEnterRef.current && final.length > 0) {
          pendingEnterRef.current = false;
          setQuery(final[0].name);
          setResults([]);
          setOpen(false);
          onSelect(final[0]);
        }
      }
    };

    // ① 로컬 검색: 강릉 중심 30km 우선 (결과 리스트 앞쪽에 위치)
    if (psRef.current) {
      psRef.current.keywordSearch(
        text,
        (res, status) => {
          if (status === kakao.maps.services.Status.OK) res.forEach((r) => addPlace(toPlace(r)));
          done();
        },
        { location: new kakao.maps.LatLng(GANGNEUNG.lat, GANGNEUNG.lng), radius: 30000, size: 8 }
      );
    } else { done(); }

    // ② 전국 검색: 반경 제한 없음 — 비슷한 이름·오타도 관련도 순으로 잡아줌
    if (psRef.current) {
      psRef.current.keywordSearch(
        text,
        (res, status) => {
          if (status === kakao.maps.services.Status.OK) res.slice(0, 6).forEach((r) => addPlace(toPlace(r)));
          done();
        },
        { size: 8 }
      );
    } else { done(); }

    // ③ 주소 검색: 도로명·지번 모두
    if (gcRef.current) {
      gcRef.current.addressSearch(text, (res, status) => {
        if (status === kakao.maps.services.Status.OK) {
          res.slice(0, 4).forEach((r) =>
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

    // ④ T-map POI 검색: 강릉 바운딩박스 내 소규모 장소·골목 보완
    searchTmapPOI(text).then((places) => {
      places.forEach(addPlace);
      done();
    }).catch(() => done());
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (place: Place) => {
    setQuery(place.name);
    setResults([]);
    setOpen(false);
    onSelect(place);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (results.length > 0) {
      // 결과 이미 있으면 즉시 첫 번째 선택
      handleSelect(results[0]);
    } else if (query.trim()) {
      // 결과 없지만 입력값 있으면 검색 완료 후 자동 선택 대기
      pendingEnterRef.current = true;
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ width: '100%', padding: '11px 14px', fontSize: '15px', border: '1.5px solid #E5E7EB', borderRadius: '12px', outline: 'none', boxSizing: 'border-box', background: '#F9FAFB', color: '#111827' }}
      />
      {open && results.length > 0 && (
        <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', marginTop: '4px', padding: 0, listStyle: 'none', zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', maxHeight: '260px', overflowY: 'auto' }}>
          {results.map((place, i) => (
            <li
              key={i}
              onClick={() => handleSelect(place)}
              style={{ padding: '11px 15px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid #F3F4F6' : 'none' }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>{place.name}</div>
              {place.address && place.address !== place.name && (
                <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>{place.address}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
