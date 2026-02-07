'use client';

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// --- Drag position persistence ---

const STORAGE_KEY = 'sentrycam-minimap-pos';

const loadPosition = (): { x: number; y: number } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos.x === 'number' && typeof pos.y === 'number') return pos;
  } catch {}
  return null;
};

const savePosition = (x: number, y: number) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
  } catch {}
};

// --- Types ---

export interface MiniMapRef {
  updateMarker: (lat: number, lng: number) => void;
}

interface MiniMapProps {
  gpsPath: [number, number][];
  visible: boolean;
  layoutId?: string;
}

// --- Component ---
// Follows teslareplay pattern: just call mapMarker.setLatLng(latlng) directly.

export const MiniMap = forwardRef<MiniMapRef, MiniMapProps>(
  ({ gpsPath, visible, layoutId }, ref) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const polylineRef = useRef<L.Polyline | null>(null);
    const markerRef = useRef<L.CircleMarker | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const mapReady = useRef(false);
    const latestLatLng = useRef<[number, number] | null>(null);

    // Drag state
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const dragging = useRef(false);
    const offset = useRef({ x: 0, y: 0 });
    const rafId = useRef(0);

    // Coords for display
    const [displayCoords, setDisplayCoords] = useState<string | null>(null);

    // Load saved position
    useEffect(() => {
      const saved = loadPosition();
      if (saved) setPos(saved);
    }, []);

    // Window-level drag listeners
    useEffect(() => {
      const onMove = (e: PointerEvent) => {
        if (!dragging.current || !wrapperRef.current) return;
        cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(() => {
          const el = wrapperRef.current;
          if (!el) return;
          const parent = el.parentElement;
          if (!parent) return;
          const parentRect = parent.getBoundingClientRect();
          const elW = el.offsetWidth;
          const elH = el.offsetHeight;
          let x = e.clientX - parentRect.left - offset.current.x;
          let y = e.clientY - parentRect.top - offset.current.y;
          x = Math.max(0, Math.min(x, parentRect.width - elW));
          y = Math.max(0, Math.min(y, parentRect.height - elH));
          setPos({ x, y });
        });
      };

      const onUp = () => {
        if (!dragging.current) return;
        dragging.current = false;
        cancelAnimationFrame(rafId.current);
        setPos((current) => {
          if (current) savePosition(current.x, current.y);
          return current;
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        cancelAnimationFrame(rafId.current);
      };
    }, []);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }, []);

    // Imperative marker update — same as teslareplay: just setLatLng, no animation
    const doUpdateMarker = useCallback((lat: number, lng: number) => {
      latestLatLng.current = [lat, lng];
      setDisplayCoords(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);

      const map = mapRef.current;
      if (!map) return;

      const latlng: L.LatLngExpression = [lat, lng];

      if (!markerRef.current) {
        markerRef.current = L.circleMarker(latlng, {
          radius: 6,
          fillColor: '#fff',
          color: '#3e9cbf',
          weight: 2,
          opacity: 1,
          fillOpacity: 1,
        }).addTo(map);
      } else {
        markerRef.current.setLatLng(latlng);
      }
    }, []);

    useImperativeHandle(ref, () => ({
      updateMarker: doUpdateMarker,
    }), [doUpdateMarker]);

    // Initialize Leaflet map
    useEffect(() => {
      if (!visible || !mapContainerRef.current || mapReady.current) return;

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
      }).setView([37.7749, -122.4194], 15);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      mapReady.current = true;

      // If we received marker updates before the map was ready, apply now
      if (latestLatLng.current) {
        doUpdateMarker(latestLatLng.current[0], latestLatLng.current[1]);
      }

      return () => {
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
        mapReady.current = false;
      };
    }, [visible, doUpdateMarker]);

    // Invalidate map size when visibility changes
    useEffect(() => {
      if (visible && mapRef.current) {
        setTimeout(() => mapRef.current?.invalidateSize(), 100);
      }
    }, [visible]);

    // Draw route polyline
    useEffect(() => {
      const map = mapRef.current;
      if (!map || gpsPath.length === 0) return;

      if (polylineRef.current) {
        polylineRef.current.remove();
      }

      const polyline = L.polyline(gpsPath, {
        color: '#3e9cbf',
        weight: 3,
        opacity: 0.7,
      }).addTo(map);

      polylineRef.current = polyline;
      map.fitBounds(polyline.getBounds(), { padding: [20, 20] });

      return () => {
        polyline.remove();
        polylineRef.current = null;
      };
    }, [gpsPath]);

    if (!visible) return null;

    const defaultPos: React.CSSProperties =
      layoutId === 'immersive'
        ? { position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)' }
        : { position: 'absolute', bottom: 12, left: 12 };

    const style: React.CSSProperties = pos
      ? { position: 'absolute', left: pos.x, top: pos.y }
      : defaultPos;

    return (
      <div ref={wrapperRef} className="z-30 select-none" style={style}>
        <div className="rounded-lg bg-black/40 backdrop-blur-md border border-white/[0.06] shadow-2xl overflow-hidden">
          {/* Drag handle */}
          <div
            className="flex items-center justify-between px-2.5 py-1.5 cursor-grab active:cursor-grabbing border-b border-white/[0.06]"
            onPointerDown={handlePointerDown}
          >
            <span className="text-[9px] text-white/40 font-semibold uppercase tracking-wider pointer-events-none">
              Map
            </span>
            {displayCoords && (
              <span className="text-[8px] text-white/25 tabular-nums pointer-events-none">
                {displayCoords}
              </span>
            )}
          </div>
          {/* Map container */}
          <div
            ref={mapContainerRef}
            className="w-60 h-48"
            style={{ zIndex: 0, opacity: 0.75 }}
          />
        </div>
      </div>
    );
  }
);

MiniMap.displayName = 'MiniMap';
