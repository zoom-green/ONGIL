import { useEffect, useRef } from 'react';
import type { LatLng, RouteCandidate, CctvPoint, SafeSpot, StreetlightPoint, ChildSafeHousePoint } from '../types';
import type { UserLocation } from '../hooks/useUserLocation';

// module-level: inject loc-pulse animation into <head> once
let _locCssInjected = false;
function injectUserDotCSS() {
  if (_locCssInjected) return;
  _locCssInjected = true;
  const s = document.createElement('style');
  s.textContent =
    '@keyframes loc-pulse{0%{opacity:.55;transform:scale(1)}100%{opacity:0;transform:scale(3.5)}}';
  document.head.appendChild(s);
}

function makeUserDotContent(heading: number | null): string {
  // ring helper: expands from the 20×20 dot center with offset on each side
  const ring = (delay: string, offset: string) =>
    `<div style="position:absolute;top:${offset};left:${offset};right:${offset};bottom:${offset};border-radius:50%;background:rgba(59,130,246,0.22);animation:loc-pulse 2s ease-out ${delay} infinite;pointer-events:none"></div>`;

  const dot =
    '<div style="width:20px;height:20px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.38);position:relative;z-index:2"></div>';

  const hasDir = heading !== null && !isNaN(heading);
  // arrow: rotates inset-0 wrapper around the dot center; triangle points up at 0° (north)
  const arrow = hasDir
    ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;transform:rotate(${Math.round(heading!)}deg)"><div style="position:absolute;left:50%;transform:translateX(-50%);top:-9px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:11px solid #1D4ED8;opacity:.9"></div></div>`
    : '';

  return `<div style="position:relative;width:20px;height:20px">${ring('0s', '-14px')}${ring('0.65s', '-7px')}${dot}${arrow}</div>`;
}

// Icons only appear when zoomed in to this level or closer (Kakao: smaller = more zoomed in)
const ICON_ZOOM_THRESHOLD = 3;

interface Props {
  center: LatLng;
  origin: LatLng | null;
  destination: LatLng | null;
  safeRoute: RouteCandidate | null;
  fastRoute: RouteCandidate | null;
  activeRoute: 'safe' | 'fast';
  cctvList: CctvPoint[];
  safeSpots: SafeSpot[];
  streetlights: StreetlightPoint[];
  showOverlays: boolean;
  onMapClick?: (pos: { lat: number; lng: number }, address: string) => void;
  userLocation?: UserLocation | null;
  childSafeHouses?: ChildSafeHousePoint[];
  crimeWmsKey?: string;
  showCrimeOverlay?: boolean;
}

export default function KakaoMap({
  center,
  origin,
  destination,
  safeRoute,
  fastRoute,
  activeRoute,
  cctvList,
  safeSpots,
  streetlights,
  showOverlays,
  onMapClick,
  userLocation,
  childSafeHouses,
  crimeWmsKey,
  showCrimeOverlay,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const objectsRef = useRef<(kakao.maps.Polyline | kakao.maps.Marker | kakao.maps.CustomOverlay)[]>([]);
  // tracks only CCTV/safespot icon overlays for zoom-based visibility
  const iconOverlaysRef = useRef<kakao.maps.CustomOverlay[]>([]);
  // separate overlay for the live user-position dot (not cleared on route redraw)
  const userOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);
  // 범죄주의구간 WMS 이미지 오버레이
  const crimeImgRef = useRef<HTMLImageElement | null>(null);
  const crimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ref so the zoom_changed closure always reads the latest prop value
  const showOverlaysRef = useRef(showOverlays);
  // ref so click closure always reads latest callback without re-registering the listener
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  // keep ref in sync and re-apply icon visibility when toggle changes
  useEffect(() => {
    showOverlaysRef.current = showOverlays;
    const map = mapRef.current;
    if (!map) return;
    const level = map.getLevel();
    const visible = showOverlays && level <= ICON_ZOOM_THRESHOLD;
    iconOverlaysRef.current.forEach((o) => o.setMap(visible ? map : null));
  }, [showOverlays]);

  // map initialisation + zoom listener (runs once)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new kakao.maps.Map(containerRef.current, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: 4,
    });
    mapRef.current = map;

    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'zoom_changed', () => {
      const level = map.getLevel();
      const visible = showOverlaysRef.current && level <= ICON_ZOOM_THRESHOLD;
      iconOverlaysRef.current.forEach((o) => o.setMap(visible ? map : null));
    });

    // 지도 클릭 → 역지오코딩 후 콜백 호출
    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'click', (mouseEvent: any) => {
      const latlng: kakao.maps.LatLng = mouseEvent.latLng;
      const geocoder = new kakao.maps.services.Geocoder();
      // @ts-expect-error kakao types incomplete — coord2Address exists at runtime
      geocoder.coord2Address(
        latlng.getLng(),
        latlng.getLat(),
        (result: any, status: kakao.maps.services.Status) => {
          const address =
            status === kakao.maps.services.Status.OK && result.length > 0
              ? (result[0].road_address?.address_name || result[0].address?.address_name || '')
              : `${latlng.getLat().toFixed(5)}, ${latlng.getLng().toFixed(5)}`;
          onMapClickRef.current?.(
            { lat: latlng.getLat(), lng: latlng.getLng() },
            address || `${latlng.getLat().toFixed(5)}, ${latlng.getLng().toFixed(5)}`
          );
        }
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live user-position dot — updates on every GPS tick without clearing the route overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!userLocation) {
      userOverlayRef.current?.setMap(null);
      return;
    }

    injectUserDotCSS();
    const pos = new kakao.maps.LatLng(userLocation.lat, userLocation.lng);

    if (!userOverlayRef.current) {
      // 타입 정의에 없는 옵션(zIndex, xAnchor, yAnchor)을 사용하기 위해 any 우회
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const overlayOpts: any = {
        position: pos,
        content: makeUserDotContent(userLocation.heading),
        map,
        zIndex: 100,
        xAnchor: 0.5,
        yAnchor: 0.5,
      };
      userOverlayRef.current = new kakao.maps.CustomOverlay(overlayOpts);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ol = userOverlayRef.current as any;
      ol.setPosition(pos);
      ol.setContent(makeUserDotContent(userLocation.heading));
    }
  }, [userLocation]);

  // cleanup user overlay on unmount
  useEffect(() => {
    return () => {
      userOverlayRef.current?.setMap(null);
      userOverlayRef.current = null;
    };
  }, []);

  // 범죄주의구간 WMS 오버레이 — 10등급(최고 밀도)만 필터링해 표시
  const crimeReqRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;

    if (!showCrimeOverlay || !crimeWmsKey) {
      if (crimeImgRef.current) {
        crimeImgRef.current.remove();
        crimeImgRef.current = null;
      }
      return;
    }

    // 오버레이 img 최초 1회 생성
    if (!crimeImgRef.current) {
      const img = document.createElement('img');
      img.style.cssText =
        'position:absolute;top:0;left:0;width:100%;height:100%;' +
        'opacity:0;pointer-events:none;z-index:10;';
      container!.appendChild(img);
      crimeImgRef.current = img;
    }

    // 이미지 소스 교체 후 로드 완료 시 표시
    const applyImage = (src: string, opacity: number) => {
      const el = crimeImgRef.current;
      if (!el) return;
      el.style.opacity = '0';
      el.onload = () => { if (crimeImgRef.current) crimeImgRef.current.style.opacity = String(opacity); };
      el.src = src;
    };

    const refreshImage = () => {
      if (!map || !container) return;
      const reqId = ++crimeReqRef.current;
      // @ts-expect-error kakao types incomplete
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const w = container.offsetWidth || 512;
      const h = container.offsetHeight || 512;
      const bbox = `${sw.getLng()},${sw.getLat()},${ne.getLng()},${ne.getLat()}`;
      const url = `https://safemap.go.kr/openapi2/IF_0087_WMS?serviceKey=${crimeWmsKey}&srs=EPSG:4326&bbox=${bbox}&format=image/png&width=${w}&height=${h}&transparent=TRUE`;

      // Canvas로 10등급 픽셀(#bd0026 = rgb(189,0,38))만 남기고 나머지 투명화
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { applyImage(url, 0.45); return; }

      const tmp = new Image();
      tmp.crossOrigin = 'anonymous';
      tmp.onload = () => {
        if (reqId !== crimeReqRef.current) return; // 오래된 요청 무시
        canvas.width = tmp.width;
        canvas.height = tmp.height;
        ctx.drawImage(tmp, 0, 0);
        try {
          const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const px = d.data;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0) continue;
            // 10등급 rgb(189,0,38), 9등급 rgb(211,26,35) → G≤18로 구분
            const is10 = px[i] >= 155 && px[i] <= 210 && px[i + 1] <= 18 && px[i + 2] >= 15 && px[i + 2] <= 65;
            px[i + 3] = is10 ? 220 : 0;
          }
          ctx.putImageData(d, 0, 0);
          applyImage(canvas.toDataURL('image/png'), 1.0);
        } catch {
          // CORS 차단 시 전체 등급 fallback
          applyImage(url, 0.45);
        }
      };
      tmp.onerror = () => { if (reqId === crimeReqRef.current) applyImage(url, 0.45); };
      tmp.src = url;
    };

    refreshImage();

    // 지도 이동/줌: 즉시 숨겨서 어긋남 방지, 350ms 후 새 좌표로 재요청
    const onBoundsChange = () => {
      if (crimeImgRef.current) crimeImgRef.current.style.opacity = '0';
      if (crimeTimerRef.current) clearTimeout(crimeTimerRef.current);
      crimeTimerRef.current = setTimeout(refreshImage, 350);
    };
    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'bounds_changed', onBoundsChange);

    return () => {
      if (crimeTimerRef.current) clearTimeout(crimeTimerRef.current);
      // @ts-expect-error kakao types incomplete
      kakao.maps.event.removeListener(map, 'bounds_changed', onBoundsChange);
      if (crimeImgRef.current) {
        crimeImgRef.current.remove();
        crimeImgRef.current = null;
      }
    };
  }, [showCrimeOverlay, crimeWmsKey]);

  // update center
  useEffect(() => {
    mapRef.current?.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
  }, [center]);

  // draw routes and markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // clear previous objects
    objectsRef.current.forEach((o) => o.setMap(null));
    objectsRef.current = [];
    iconOverlaysRef.current = [];

    const add = (o: kakao.maps.Polyline | kakao.maps.Marker | kakao.maps.CustomOverlay) => {
      objectsRef.current.push(o);
    };

    // draw fast route (gray, behind)
    if (fastRoute && activeRoute === 'safe') {
      const line = new kakao.maps.Polyline({
        path: fastRoute.nodes.map((n) => new kakao.maps.LatLng(n.lat, n.lng)),
        strokeWeight: 5,
        strokeColor: '#9CA3AF',
        strokeOpacity: 0.5,
        strokeStyle: 'dashed',
        map,
      });
      add(line);
    }

    // draw safe route (blue, front)
    if (safeRoute && activeRoute === 'safe') {
      const line = new kakao.maps.Polyline({
        path: safeRoute.nodes.map((n) => new kakao.maps.LatLng(n.lat, n.lng)),
        strokeWeight: 7,
        strokeColor: '#3B82F6',
        strokeOpacity: 0.9,
        map,
      });
      add(line);
    }

    // draw fast route only
    if (fastRoute && activeRoute === 'fast') {
      const lineSafe = safeRoute
        ? new kakao.maps.Polyline({
            path: safeRoute.nodes.map((n) => new kakao.maps.LatLng(n.lat, n.lng)),
            strokeWeight: 5,
            strokeColor: '#3B82F6',
            strokeOpacity: 0.4,
            strokeStyle: 'dashed',
            map,
          })
        : null;
      if (lineSafe) add(lineSafe);

      const line = new kakao.maps.Polyline({
        path: fastRoute.nodes.map((n) => new kakao.maps.LatLng(n.lat, n.lng)),
        strokeWeight: 7,
        strokeColor: '#F97316',
        strokeOpacity: 0.9,
        map,
      });
      add(line);
    }

    // CCTV / safespot icons — visible only when zoomed in (zoom_changed listener controls this)
    if (showOverlays) {
      const iconsVisible = map.getLevel() <= ICON_ZOOM_THRESHOLD;

      for (const c of cctvList) {
        const overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(c.lat, c.lng),
          content: '<div style="width:22px;height:22px;background:#2563EB;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg></div>',
        });
        if (iconsVisible) overlay.setMap(map);
        iconOverlaysRef.current.push(overlay);
        add(overlay);
      }

      for (const s of safeSpots) {
        const cat = s.category;
        const content =
          cat.includes('경찰') || cat.includes('지구대') || cat.includes('파출소')
            ? '<div style="width:22px;height:22px;background:#1E3A8A;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M12 2L4 6v5.5C4 16.55 7.84 21.74 12 23c4.16-1.26 8-6.45 8-11.5V6l-8-4z"/></svg></div>'
          : cat.includes('소방')
            ? '<div style="width:22px;height:22px;background:#DC2626;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M19.48 12.35c-1.57-4.08-7.16-4.3-5.81-10.23.1-.44-.37-.78-.75-.55C9.29 3.71 6.68 8 8.87 13.62c.18.46-.36.89-.75.59-1.81-1.37-2-3.34-1.84-4.75.06-.52-.62-.77-.91-.34C4.69 10.16 4 11.84 4 14c0 4.22 3.58 7.64 8 7.64 5.46 0 9.4-5.18 7.48-9.29z"/></svg></div>'
          : cat.includes('편의점')
            ? '<div style="width:22px;height:22px;background:#059669;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2c0 .55.45 1 1 1s1-.45 1-1V8h4v2c0 .55.45 1 1 1s1-.45 1-1V8h2v12z"/></svg></div>'
          : cat.includes('카페')
            ? '<div style="width:22px;height:22px;background:#78350F;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/></svg></div>'
          : cat.includes('약국')
            ? '<div style="width:22px;height:22px;background:#0891B2;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg></div>'
            : '<div style="width:22px;height:22px;background:#D97706;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg></div>';
        const overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(s.lat, s.lng),
          content,
        });
        if (iconsVisible) overlay.setMap(map);
        iconOverlaysRef.current.push(overlay);
        add(overlay);
      }

      for (const h of (childSafeHouses ?? [])) {
        const overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(h.lat, h.lng),
          content: '<div style="width:22px;height:22px;background:#F97316;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:default"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg></div>',
        });
        if (iconsVisible) overlay.setMap(map);
        iconOverlaysRef.current.push(overlay);
        add(overlay);
      }

      for (const light of streetlights) {
        const content = '<div style="width:16px;height:16px;background:#F59E0B;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:default"><svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></div>';
        const overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(light.lat, light.lng),
          content,
        });
        if (iconsVisible) overlay.setMap(map);
        iconOverlaysRef.current.push(overlay);
        add(overlay);
      }
    }

    // origin marker
    if (origin) {
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(origin.lat, origin.lng),
        content: '<div style="background:#3B82F6;color:#fff;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.25)">📍 출발</div>',
        map,
        yAnchor: 1.3,
      });
      add(overlay);
    }

    // destination marker
    if (destination) {
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(destination.lat, destination.lng),
        content: '<div style="background:#EF4444;color:#fff;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.25)">🏁 도착</div>',
        map,
        yAnchor: 1.3,
      });
      add(overlay);
    }

    // fit bounds
    if (safeRoute && safeRoute.nodes.length > 0) {
      const bounds = new kakao.maps.LatLngBounds();
      safeRoute.nodes.forEach((n) => bounds.extend(new kakao.maps.LatLng(n.lat, n.lng)));
      if (destination) bounds.extend(new kakao.maps.LatLng(destination.lat, destination.lng));
      if (origin) bounds.extend(new kakao.maps.LatLng(origin.lat, origin.lng));
      // @ts-expect-error kakao types incomplete
      map.setBounds(bounds);
    }

  }, [safeRoute, fastRoute, activeRoute, origin, destination, cctvList, safeSpots, streetlights, showOverlays, childSafeHouses]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
