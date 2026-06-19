import { useEffect, useRef } from 'react';
import type { LatLng, RouteCandidate, CctvPoint, SafeSpot, StreetlightPoint } from '../types';

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const objectsRef = useRef<(kakao.maps.Polyline | kakao.maps.Marker | kakao.maps.CustomOverlay)[]>([]);
  // tracks only CCTV/safespot icon overlays for zoom-based visibility
  const iconOverlaysRef = useRef<kakao.maps.CustomOverlay[]>([]);
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

  }, [safeRoute, fastRoute, activeRoute, origin, destination, cctvList, safeSpots, streetlights, showOverlays]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
