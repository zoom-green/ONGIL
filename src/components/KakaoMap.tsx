import { useEffect, useRef } from 'react';
import type { LatLng, MapBounds, RouteCandidate, CctvPoint, SafeSpot, StreetlightPoint, ChildSafeHousePoint, SafetyPoint } from '../types';
import type { UserLocation } from '../hooks/useUserLocation';
import { getSafetyFeature } from '../utils/safetyFeatures';

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

const GANGNEUNG_BOUNDS = {
  south: 37.45,
  west: 128.65,
  north: 37.95,
  east: 129.12,
};
const SAFETY_MARKER_ZOOM_THRESHOLD = 6;

function isInsideGangneungBounds(lat: number, lng: number): boolean {
  return lat >= GANGNEUNG_BOUNDS.south && lat <= GANGNEUNG_BOUNDS.north
    && lng >= GANGNEUNG_BOUNDS.west && lng <= GANGNEUNG_BOUNDS.east;
}

function getRenderRouteNodes(nodes: LatLng[], maxPoints = 240): LatLng[] {
  if (nodes.length <= maxPoints) return nodes;
  const step = Math.ceil(nodes.length / maxPoints);
  const rendered: LatLng[] = [];
  for (let index = 0; index < nodes.length; index += step) {
    rendered.push(nodes[index]);
  }
  const last = nodes[nodes.length - 1];
  if (rendered[rendered.length - 1] !== last) rendered.push(last);
  return rendered;
}

function toKakaoPath(nodes: LatLng[]) {
  return getRenderRouteNodes(nodes).map((n) => new kakao.maps.LatLng(n.lat, n.lng));
}

function canShowSafetyMarkers(map: kakao.maps.Map, showOverlays: boolean, hasRouteEvidence: boolean, interacting: boolean): boolean {
  return !interacting && map.getLevel() <= SAFETY_MARKER_ZOOM_THRESHOLD && (showOverlays || hasRouteEvidence);
}

function safetyIconSvg(featureId: string, size: number): string {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"`;
  if (featureId === 'cctv') return `<svg ${common}><path d="M4 11a8 8 0 0 1 16 0v3H4z"/><path d="M7 14v3h10v-3"/><circle cx="12" cy="13" r="2.2"/><path d="M12 17v3"/><path d="M9 20h6"/></svg>`;
  if (featureId === 'food') return `<svg ${common}><path d="M7 3v8"/><path d="M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3"/><path d="M7 11v10"/><path d="M16 3c2 1.8 3 4 3 6.5 0 2-1.1 3.5-3 3.5h-1V3z"/><path d="M16 13v8"/><path d="M11.5 5.5h2.5"/></svg>`;
  if (featureId === 'convenience') return `<svg ${common}><path d="M4 9h16v11H4z"/><path d="M7 20v-6h10v6"/><path d="M9 20v-6"/><path d="M15 20v-6"/><path d="M8 6h8l2 3H6z"/><text x="12" y="13" text-anchor="middle" font-size="6.2" fill="white" stroke="none" font-weight="900">24</text></svg>`;
  if (featureId === 'police') return `<svg ${common}><path d="M12 3l7 3v5c0 4.5-3 7.8-7 10-4-2.2-7-5.5-7-10V6l7-3z"/><path d="M8.5 10.5l2.4 2.4 4.8-5"/><text x="12" y="18" text-anchor="middle" font-size="5.2" fill="white" stroke="none" font-weight="900">112</text></svg>`;
  if (featureId === 'fire') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"><text x="12" y="13.5" text-anchor="middle" font-size="10" fill="white" font-weight="900" font-style="italic">119</text><path d="M5.5 17.2h4.5M11.2 17.2h4.5M16.6 17.2h2.4" stroke="white" stroke-width="2.1" stroke-linecap="round"/><path d="M4.8 20h4.3M10.5 20h4.3M16 20h3.2" stroke="white" stroke-width="2.1" stroke-linecap="round"/></svg>`;
  if (featureId === 'light') return `<svg ${common}><path d="M8 21h7"/><path d="M9.5 18h4"/><path d="M10 18V7a4 4 0 0 1 8 0v3"/><path d="M17 10h3"/><path d="M14.5 13h7"/><path d="M15.5 13a3 3 0 0 1 5 0"/><path d="M18 13v2.5"/><path d="M15.5 17l-2 2"/><path d="M20.5 17l2 2"/></svg>`;
  if (featureId === 'childSafeHouse') return `<svg ${common}><path d="M4 11.5L12 4l8 7.5"/><path d="M6.5 10.5V20h11v-9.5"/><path d="M10 20v-5h4v5"/><path d="M9 11.5h6"/></svg>`;
  if (featureId === 'medical') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="white"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>`;
  if (featureId === 'toilet') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="white"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="8" r="1.5" fill="${featureId === 'toilet' ? '#9A65DE' : 'white'}"/><circle cx="16" cy="8" r="1.5" fill="${featureId === 'toilet' ? '#9A65DE' : 'white'}"/><path d="M7 11h2l1 6H6z" fill="${featureId === 'toilet' ? '#9A65DE' : 'white'}"/><path d="M15 11h2l1 6h-4z" fill="${featureId === 'toilet' ? '#9A65DE' : 'white'}"/><path d="M12 6v12" stroke="${featureId === 'toilet' ? '#9A65DE' : 'white'}" stroke-width="1.3"/></svg>`;
  return `<svg ${common}><path d="M12 4v10"/><path d="M12 18h.01"/><path d="M6 8a6 6 0 0 1 12 0"/></svg>`;
}

function endpointMarkerContent(type: 'origin' | 'destination'): string {
  const isOrigin = type === 'origin';
  const bg = isOrigin ? '#7374EE' : '#D35B52';
  const label = isOrigin ? '출발' : '도착';
  const pinSvg = '<svg width="14" height="18" viewBox="0 0 24 32" fill="none" style="display:block;flex:0 0 auto"><path d="M12 31s10-10.1 10-19A10 10 0 1 0 2 12c0 8.9 10 19 10 19z" fill="white"/><circle cx="12" cy="12" r="4.2" fill="' + bg + '"/></svg>';
  return (
    '<div style="position:relative;display:inline-flex;align-items:center;gap:7px;' +
    `background:${bg};color:#fff;padding:8px 13px;border-radius:14px;` +
    'font-size:16px;font-weight:900;line-height:1;white-space:nowrap;' +
    'box-shadow:0 4px 12px rgba(15,23,42,0.22);font-family:\'Apple SD Gothic Neo\',\'Noto Sans KR\',sans-serif">' +
    pinSvg +
    `<span>${label}</span>` +
    `<span style="position:absolute;left:21px;bottom:-7px;width:14px;height:14px;background:${bg};transform:rotate(45deg);border-radius:3px"></span>` +
    '</div>'
  );
}

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
  onBoundsChange?: (bounds: MapBounds) => void;
  userLocation?: UserLocation | null;
  childSafeHouses?: ChildSafeHousePoint[];
  safetyPoints?: SafetyPoint[];
  routeEvidencePoints?: SafetyPoint[];
  safemapWmsLayers?: string[];
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
  onBoundsChange,
  userLocation,
  childSafeHouses,
  safetyPoints = [],
  routeEvidencePoints = [],
  safemapWmsLayers = [],
  crimeWmsKey,
  showCrimeOverlay,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const objectsRef = useRef<(kakao.maps.Polyline | kakao.maps.Marker | kakao.maps.CustomOverlay)[]>([]);
  const routeLineRefs = useRef<Array<{ line: kakao.maps.Polyline; opacity: number }>>([]);
  // tracks only CCTV/safespot icon overlays for zoom-based visibility
  const iconOverlaysRef = useRef<kakao.maps.CustomOverlay[]>([]);
  const safetyOverlayCacheRef = useRef<Map<string, { overlay: kakao.maps.CustomOverlay; content: string }>>(new Map());
  // separate overlay for the live user-position dot (not cleared on route redraw)
  const userOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);
  // 범죄주의구간 WMS 이미지 오버레이
  const crimeImgRef = useRef<HTMLImageElement | null>(null);
  const crimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safemapWmsImgsRef = useRef<HTMLImageElement[]>([]);
  const safemapWmsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boundsEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsKeyRef = useRef('');
  const lastFitRouteKeyRef = useRef('');
  const mapInteractingRef = useRef(false);
  // ref so the zoom_changed closure always reads the latest prop value
  const showOverlaysRef = useRef(showOverlays);
  const hasRouteEvidenceRef = useRef(routeEvidencePoints.length > 0);
  // ref so click closure always reads latest callback without re-registering the listener
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  const onBoundsChangeRef = useRef(onBoundsChange);
  useEffect(() => { onBoundsChangeRef.current = onBoundsChange; }, [onBoundsChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onBoundsChange) return;
    // @ts-expect-error kakao types incomplete
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const currentCenter = map.getCenter();
    onBoundsChange({
      sw: { lat: sw.getLat(), lng: sw.getLng() },
      ne: { lat: ne.getLat(), lng: ne.getLng() },
      center: { lat: currentCenter.getLat(), lng: currentCenter.getLng() },
    });
  }, [onBoundsChange]);

  // keep ref in sync and re-apply icon visibility when toggle changes
  useEffect(() => {
    showOverlaysRef.current = showOverlays;
    hasRouteEvidenceRef.current = routeEvidencePoints.length > 0;
    const map = mapRef.current;
    if (!map) return;
    const visible = canShowSafetyMarkers(map, showOverlays, routeEvidencePoints.length > 0, mapInteractingRef.current);
    iconOverlaysRef.current.forEach((o) => o.setMap(visible ? map : null));
  }, [showOverlays, routeEvidencePoints.length]);

  // map initialisation + zoom listener (runs once)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new kakao.maps.Map(containerRef.current, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: 4,
    });
    mapRef.current = map;

    const emitBounds = () => {
      if (!onBoundsChangeRef.current) return;
      // @ts-expect-error kakao types incomplete
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const currentCenter = map.getCenter();
      const nextKey = [
        sw.getLat(),
        sw.getLng(),
        ne.getLat(),
        ne.getLng(),
      ].map((value) => value.toFixed(4)).join(',');
      if (lastBoundsKeyRef.current === nextKey) return;
      lastBoundsKeyRef.current = nextKey;
      onBoundsChangeRef.current?.({
        sw: { lat: sw.getLat(), lng: sw.getLng() },
        ne: { lat: ne.getLat(), lng: ne.getLng() },
        center: { lat: currentCenter.getLat(), lng: currentCenter.getLng() },
      });
    };
    const emitBoundsSoon = () => {
      if (!onBoundsChangeRef.current) return;
      if (boundsEmitTimerRef.current) clearTimeout(boundsEmitTimerRef.current);
      boundsEmitTimerRef.current = setTimeout(emitBounds, 450);
    };
    const hideSafetyOverlaysWhileMoving = () => {
      mapInteractingRef.current = true;
      iconOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      routeLineRefs.current.forEach(({ line }) => (line as any).setOptions({ strokeOpacity: 0.16 }));
    };
    const restoreSafetyOverlaysAfterMoving = () => {
      mapInteractingRef.current = false;
      const visible = canShowSafetyMarkers(map, showOverlaysRef.current, hasRouteEvidenceRef.current, false);
      iconOverlaysRef.current.forEach((overlay) => overlay.setMap(visible ? map : null));
      routeLineRefs.current.forEach(({ line, opacity }) => (line as any).setOptions({ strokeOpacity: opacity }));
      emitBoundsSoon();
    };
    emitBounds();

    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'dragstart', hideSafetyOverlaysWhileMoving);
    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'zoom_start', hideSafetyOverlaysWhileMoving);
    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'zoom_changed', () => {
      const visible = canShowSafetyMarkers(map, showOverlaysRef.current, hasRouteEvidenceRef.current, mapInteractingRef.current);
      iconOverlaysRef.current.forEach((o) => o.setMap(visible ? map : null));
    });
    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'idle', restoreSafetyOverlaysAfterMoving);

    // 지도 클릭 → 역지오코딩 후 콜백 호출
    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'click', (mouseEvent: any) => {
      const latlng: kakao.maps.LatLng = mouseEvent.latLng;
      const fallbackAddress = `${latlng.getLat().toFixed(5)}, ${latlng.getLng().toFixed(5)}`;
      onMapClickRef.current?.(
        { lat: latlng.getLat(), lng: latlng.getLng() },
        fallbackAddress
      );
      const geocoder = new kakao.maps.services.Geocoder();
      // @ts-expect-error kakao types incomplete — coord2Address exists at runtime
      geocoder.coord2Address(
        latlng.getLng(),
        latlng.getLat(),
        (result: any, status: kakao.maps.services.Status) => {
          const address =
            status === kakao.maps.services.Status.OK && result.length > 0
              ? (result[0].road_address?.address_name || result[0].address?.address_name || '')
              : fallbackAddress;
          onMapClickRef.current?.(
            { lat: latlng.getLat(), lng: latlng.getLng() },
            address || fallbackAddress
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
      crimeTimerRef.current = setTimeout(refreshImage, 700);
    };
    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'idle', onBoundsChange);

    return () => {
      if (crimeTimerRef.current) clearTimeout(crimeTimerRef.current);
      // @ts-expect-error kakao types incomplete
      kakao.maps.event.removeListener(map, 'idle', onBoundsChange);
      if (crimeImgRef.current) {
        crimeImgRef.current.remove();
        crimeImgRef.current = null;
      }
    };
  }, [showCrimeOverlay, crimeWmsKey]);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;

    const clearImages = () => {
      safemapWmsImgsRef.current.forEach((img) => img.remove());
      safemapWmsImgsRef.current = [];
    };

    if (!map || !container || safemapWmsLayers.length === 0 || !showOverlays) {
      clearImages();
      return;
    }

    const refreshImages = () => {
      const center = map.getCenter();
      if (!isInsideGangneungBounds(center.getLat(), center.getLng())) {
        clearImages();
        return;
      }

      // @ts-expect-error kakao types incomplete
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const w = container.offsetWidth || 512;
      const h = container.offsetHeight || 512;
      const bbox = `${sw.getLng()},${sw.getLat()},${ne.getLng()},${ne.getLat()}`;

      clearImages();
      safemapWmsImgsRef.current = safemapWmsLayers.map((url, index) => {
        const img = document.createElement('img');
        img.style.cssText =
          'position:absolute;top:0;left:0;width:100%;height:100%;' +
          `opacity:${index === 0 ? '0.72' : '0.58'};pointer-events:none;z-index:${11 + index};`;
        img.src = `${url}&bbox=${encodeURIComponent(bbox)}&width=${w}&height=${h}`;
        container.appendChild(img);
        return img;
      });
    };

    refreshImages();

    const onBoundsChange = () => {
      if (safemapWmsTimerRef.current) clearTimeout(safemapWmsTimerRef.current);
      safemapWmsTimerRef.current = setTimeout(refreshImages, 700);
    };

    // @ts-expect-error kakao types incomplete
    kakao.maps.event.addListener(map, 'idle', onBoundsChange);

    return () => {
      if (safemapWmsTimerRef.current) clearTimeout(safemapWmsTimerRef.current);
      // @ts-expect-error kakao types incomplete
      kakao.maps.event.removeListener(map, 'idle', onBoundsChange);
      clearImages();
    };
  }, [safemapWmsLayers, showOverlays]);

  // update center
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const current = map.getCenter();
    const isSameCenter =
      Math.abs(current.getLat() - center.lat) < 0.00001 &&
      Math.abs(current.getLng() - center.lng) < 0.00001;
    if (isSameCenter) return;
    map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
    window.setTimeout(() => {
      if (!onBoundsChangeRef.current) return;
      // @ts-expect-error kakao types incomplete
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const currentCenter = map.getCenter();
      onBoundsChangeRef.current?.({
        sw: { lat: sw.getLat(), lng: sw.getLng() },
        ne: { lat: ne.getLat(), lng: ne.getLng() },
        center: { lat: currentCenter.getLat(), lng: currentCenter.getLng() },
      });
    }, 0);
  }, [center]);

  // draw routes and markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // clear previous objects
    objectsRef.current.forEach((o) => o.setMap(null));
    objectsRef.current = [];
    routeLineRefs.current = [];
    iconOverlaysRef.current = [];

    const add = (o: kakao.maps.Polyline | kakao.maps.Marker | kakao.maps.CustomOverlay) => {
      objectsRef.current.push(o);
    };
    const activeSafetyOverlayKeys = new Set<string>();
    const scheduleSafetyOverlay = (key: string, position: LatLng, content: string) => {
      activeSafetyOverlayKeys.add(key);
      const cached = safetyOverlayCacheRef.current.get(key);
      if (cached && cached.content === content) {
        const visible = canShowSafetyMarkers(map, showOverlays, routeEvidencePoints.length > 0, mapInteractingRef.current);
        cached.overlay.setMap(visible ? map : null);
        iconOverlaysRef.current.push(cached.overlay);
        return;
      }

      if (cached) cached.overlay.setMap(null);
      const overlayOptions = {
        position: new kakao.maps.LatLng(position.lat, position.lng),
        content,
        zIndex: 20,
      } as kakao.maps.CustomOverlayOptions & { zIndex: number };
      const overlay = new kakao.maps.CustomOverlay(overlayOptions);
      const visible = canShowSafetyMarkers(map, showOverlays, routeEvidencePoints.length > 0, mapInteractingRef.current);
      overlay.setMap(visible ? map : null);
      safetyOverlayCacheRef.current.set(key, { overlay, content });
      iconOverlaysRef.current.push(overlay);
    };

    // draw fast route (gray, behind)
    if (fastRoute && activeRoute === 'safe') {
      const opacity = 0.5;
      const line = new kakao.maps.Polyline({
        path: toKakaoPath(fastRoute.nodes),
        strokeWeight: 5,
        strokeColor: '#9CA3AF',
        strokeOpacity: opacity,
        strokeStyle: 'dashed',
        map,
      });
      routeLineRefs.current.push({ line, opacity });
      add(line);
    }

    // draw safe route (blue, front)
    if (safeRoute && activeRoute === 'safe') {
      const opacity = 0.9;
      const line = new kakao.maps.Polyline({
        path: toKakaoPath(safeRoute.nodes),
        strokeWeight: 7,
        strokeColor: '#3B82F6',
        strokeOpacity: opacity,
        map,
      });
      routeLineRefs.current.push({ line, opacity });
      add(line);
    }

    // draw fast route only
    if (fastRoute && activeRoute === 'fast') {
      const lineSafe = safeRoute
        ? new kakao.maps.Polyline({
            path: toKakaoPath(safeRoute.nodes),
            strokeWeight: 5,
            strokeColor: '#3B82F6',
            strokeOpacity: 0.4,
            strokeStyle: 'dashed',
            map,
          })
        : null;
      if (lineSafe) {
        routeLineRefs.current.push({ line: lineSafe, opacity: 0.4 });
        add(lineSafe);
      }

      const opacity = 0.9;
      const line = new kakao.maps.Polyline({
        path: toKakaoPath(fastRoute.nodes),
        strokeWeight: 7,
        strokeColor: '#F97316',
        strokeOpacity: opacity,
        map,
      });
      routeLineRefs.current.push({ line, opacity });
      add(line);
    }

    // Safety icons and route evidence points appear only when the map is zoomed in enough.
    if (showOverlays || routeEvidencePoints.length > 0) {
      const iconsVisible = canShowSafetyMarkers(map, showOverlays, routeEvidencePoints.length > 0, mapInteractingRef.current);

      const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch] ?? ch));

      const makeSafetyMarkerContent = (feature: ReturnType<typeof getSafetyFeature>, title: string, size = 30, label?: string) => {
        const markerSize = Math.round(size * 0.58);
        const imageHtml = feature.iconFile
          ? `<img src="/icons/${feature.iconFile}" width="${markerSize}" height="${markerSize}" style="display:block;width:${markerSize}px;height:${markerSize}px;object-fit:cover"/>`
          : safetyIconSvg(feature.id, Math.round(markerSize * 0.72));
        const iconHtml = (
          `<div title="${title}" style="width:${markerSize}px;height:${markerSize}px;position:relative;border-radius:4px;background:${feature.color};border:0;box-shadow:none;opacity:.72;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:default">` +
          `<div style="display:flex;align-items:center;justify-content:center">${imageHtml}</div>` +
          '</div>'
        );
        if (!label) return iconHtml;
        return (
          '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none">' +
          iconHtml +
          `<div style="max-width:112px;background:#fff;color:${feature.color};border:1px solid ${feature.color};border-radius:6px;padding:2px 5px;font-size:10px;font-weight:800;line-height:1.25;text-align:center;box-shadow:none;word-break:keep-all;overflow-wrap:anywhere">${label}</div>` +
          '</div>'
        );
      };
      const visibleSafetyPoints = new Map<string, SafetyPoint>();
      if (showOverlays) {
        for (const point of safetyPoints) visibleSafetyPoints.set(point.id, point);
      }
      for (const point of routeEvidencePoints) visibleSafetyPoints.set(point.id, point);

      for (const point of visibleSafetyPoints.values()) {
        const feature = getSafetyFeature(point.featureId);
        const title = escapeHtml(point.name || feature.label);
        const label = point.featureId === 'childSafeHouse' && point.displayLabel ? escapeHtml(point.displayLabel) : undefined;
        const content = makeSafetyMarkerContent(feature, title, 30, label);
        if (iconsVisible) scheduleSafetyOverlay(`safety:${point.id}`, point, content);
      }

      for (const c of cctvList) {
        const feature = getSafetyFeature('cctv');
        const title = escapeHtml(c.name || feature.label);
        const content = makeSafetyMarkerContent(feature, title);
        if (iconsVisible) scheduleSafetyOverlay(`cctv:${c.lat.toFixed(6)},${c.lng.toFixed(6)}:${title}`, c, content);
      }

      for (const s of safeSpots) {
        const cat = s.category;
        const featureId =
          cat.includes('경찰') || cat.includes('지구대') || cat.includes('파출소')
            ? 'police'
          : cat.includes('소방')
            ? 'fire'
          : cat.includes('편의점')
            ? 'convenience'
          : cat.includes('카페')
            ? 'food'
          : cat.includes('병원')
            ? 'medical'
            : 'food';
        const feature = getSafetyFeature(featureId);
        const content = makeSafetyMarkerContent(feature, escapeHtml(s.name || feature.label));
        if (iconsVisible) scheduleSafetyOverlay(`safeSpot:${s.lat.toFixed(6)},${s.lng.toFixed(6)}:${featureId}:${s.name}`, s, content);
      }

      for (const light of streetlights) {
        const feature = getSafetyFeature('light');
        const content = makeSafetyMarkerContent(feature, escapeHtml(light.name || feature.label));
        if (iconsVisible) scheduleSafetyOverlay(`light:${light.lat.toFixed(6)},${light.lng.toFixed(6)}:${light.name ?? ''}`, light, content);
      }
    }
    for (const [key, cached] of safetyOverlayCacheRef.current) {
      if (activeSafetyOverlayKeys.has(key)) continue;
      cached.overlay.setMap(null);
    }

    for (const h of (childSafeHouses ?? [])) {
      const safeName = h.name.replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch] ?? ch));
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(h.lat, h.lng),
        yAnchor: 1,
        content:
          '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none">' +
          '<div style="width:26px;height:26px;background:#F97316;border-radius:6px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.3)">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>' +
          '</div>' +
          `<div style="max-width:104px;background:#fff;color:#9A3412;border:1px solid #FDBA74;border-radius:6px;padding:2px 5px;font-size:10px;font-weight:700;line-height:1.25;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.18);word-break:keep-all;overflow-wrap:anywhere">${safeName}</div>` +
          '</div>',
        map,
      });
      add(overlay);
    }

    // origin marker
    if (origin) {
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(origin.lat, origin.lng),
        content: endpointMarkerContent('origin'),
        map,
        yAnchor: 1.3,
      });
      add(overlay);
    }

    // destination marker
    if (destination) {
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(destination.lat, destination.lng),
        content: endpointMarkerContent('destination'),
        map,
        yAnchor: 1.3,
      });
      add(overlay);
    }

    // Fit the route once per selected route. Re-fitting on every marker update
    // makes manual pan/zoom feel like the map is fighting the user.
    const routeForFit = activeRoute === 'fast' ? fastRoute : safeRoute;
    const routeFitKey = routeForFit
      ? [
          activeRoute,
          routeForFit.nodes.length,
          routeForFit.nodes[0]
            ? `${routeForFit.nodes[0].lat.toFixed(5)},${routeForFit.nodes[0].lng.toFixed(5)}`
            : 'no-first',
          routeForFit.nodes[routeForFit.nodes.length - 1]
            ? `${routeForFit.nodes[routeForFit.nodes.length - 1].lat.toFixed(5)},${routeForFit.nodes[routeForFit.nodes.length - 1].lng.toFixed(5)}`
            : 'no-last',
          origin ? `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}` : 'no-origin',
          destination ? `${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}` : 'no-destination',
        ].join('|')
      : '';

    if (!routeForFit) {
      lastFitRouteKeyRef.current = '';
    }

    if (routeForFit && routeForFit.nodes.length > 0 && lastFitRouteKeyRef.current !== routeFitKey) {
      lastFitRouteKeyRef.current = routeFitKey;
      const bounds = new kakao.maps.LatLngBounds();
      routeForFit.nodes.forEach((n) => bounds.extend(new kakao.maps.LatLng(n.lat, n.lng)));
      if (destination) bounds.extend(new kakao.maps.LatLng(destination.lat, destination.lng));
      if (origin) bounds.extend(new kakao.maps.LatLng(origin.lat, origin.lng));
      // @ts-expect-error kakao types incomplete
      map.setBounds(bounds);
    }

    return () => {
      for (const cached of safetyOverlayCacheRef.current.values()) {
        cached.overlay.setMap(null);
      }
    };

  }, [safeRoute, fastRoute, activeRoute, origin, destination, cctvList, safeSpots, streetlights, showOverlays, childSafeHouses, safetyPoints, routeEvidencePoints]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
