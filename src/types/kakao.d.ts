declare namespace kakao {
  namespace maps {
    class Map {
      constructor(container: HTMLElement, options: MapOptions);
      setCenter(latlng: LatLng): void;
      getCenter(): LatLng;
      setLevel(level: number): void;
      getLevel(): number;
    }
    class LatLng {
      constructor(lat: number, lng: number);
      getLat(): number;
      getLng(): number;
    }
    class LatLngBounds {
      constructor();
      extend(latlng: LatLng): void;
    }
    class Marker {
      constructor(options: MarkerOptions);
      setMap(map: Map | null): void;
      getPosition(): LatLng;
    }
    class CustomOverlay {
      constructor(options: CustomOverlayOptions);
      setMap(map: Map | null): void;
    }
    class Polyline {
      constructor(options: PolylineOptions);
      setMap(map: Map | null): void;
    }
    class Circle {
      constructor(options: CircleOptions);
      setMap(map: Map | null): void;
    }
    interface MapOptions {
      center: LatLng;
      level: number;
    }
    interface MarkerOptions {
      position: LatLng;
      map?: Map;
      image?: MarkerImage;
    }
    interface CustomOverlayOptions {
      position: LatLng;
      content: string | HTMLElement;
      map?: Map;
      yAnchor?: number;
    }
    interface PolylineOptions {
      path: LatLng[];
      strokeWeight?: number;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeStyle?: string;
      map?: Map;
    }
    interface CircleOptions {
      center: LatLng;
      radius: number;
      strokeWeight?: number;
      strokeColor?: string;
      strokeOpacity?: number;
      fillColor?: string;
      fillOpacity?: number;
      map?: Map;
    }
    class MarkerImage {
      constructor(src: string, size: Size, options?: MarkerImageOptions);
    }
    class Size {
      constructor(width: number, height: number);
    }
    class Point {
      constructor(x: number, y: number);
    }
    interface MarkerImageOptions {
      offset?: Point;
    }
    function load(callback: () => void): void;
    namespace services {
      class Places {
        keywordSearch(
          keyword: string,
          callback: (result: PlacesSearchResult[], status: Status) => void,
          options?: PlacesSearchOptions
        ): void;
      }
      class Geocoder {
        addressSearch(
          addr: string,
          callback: (result: AddressSearchResult[], status: Status) => void
        ): void;
      }
      interface PlacesSearchResult {
        place_name: string;
        road_address_name: string;
        address_name: string;
        x: string;
        y: string;
        category_name: string;
      }
      interface AddressSearchResult {
        address_name: string;
        x: string;
        y: string;
        road_address: { address_name: string } | null;
      }
      interface PlacesSearchOptions {
        location?: LatLng;
        radius?: number;
        bounds?: LatLngBounds;
        category_group_code?: string;
        size?: number;
      }
      enum Status {
        OK = 'OK',
        ZERO_RESULT = 'ZERO_RESULT',
        ERROR = 'ERROR',
      }
    }
  }
}
