'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import type { SeiMetadata } from '@/lib/telemetry';
import {
  GEAR_LABELS,
  AUTOPILOT_LABELS,
  mpsToMph,
  accelToG,
} from '@/lib/telemetry';

interface TelemetryDashboardProps {
  sei: SeiMetadata | null;
  visible: boolean;
}

// --- Sub-components (same pattern as teslareplay: CSS transition + direct style) ---

const SpeedCluster = ({ mps, gear }: { mps: number; gear: number }) => {
  const mph = Math.max(0, mpsToMph(mps));
  const whole = Math.floor(mph);
  const decimal = (mph % 1).toFixed(1).slice(1); // ".X"
  const gears = [0, 2, 3, 1]; // P R N D

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-baseline gap-0 w-[120px]">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-white leading-none text-right min-w-[2.25rem]">
          {whole}
        </span>
        <span className="text-lg font-medium tabular-nums text-white/50 leading-none w-[18px]">
          {decimal}
        </span>
        <span className="text-[11px] font-medium text-white/30 ml-1.5 self-end mb-[3px]">
          MPH
        </span>
      </div>
      <div className="flex gap-0.5">
        {gears.map((g) => {
          const label = GEAR_LABELS[g];
          const isActive = gear === g;
          return (
            <span
              key={g}
              className={`text-[10px] font-semibold w-[18px] h-[18px] flex items-center justify-center rounded transition-colors ${
                isActive
                  ? g === 2
                    ? 'bg-red-500/30 text-red-400'
                    : 'bg-white/15 text-white'
                  : 'text-white/15'
              }`}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Steering wheel — exactly like teslareplay:
 * CSS transition on the element, set transform via style.
 */
const SteeringWheel = ({ angle }: { angle: number }) => (
  <div
    className="w-11 h-11 flex-shrink-0"
    style={{
      transform: `rotate(${angle}deg)`,
      transition: 'transform 0.1s linear',
    }}
  >
    <svg viewBox="0 0 60 60" className="w-full h-full">
      <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/25" />
      <line x1="30" y1="6" x2="30" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/35" />
      <line x1="8" y1="38" x2="18" y2="33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/35" />
      <line x1="52" y1="38" x2="42" y2="33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/35" />
      <circle cx="30" cy="30" r="3.5" fill="currentColor" className="text-white/20" />
      <circle cx="30" cy="6" r="2" fill="currentColor" className="text-sky-400" />
    </svg>
  </div>
);

const PedalBars = ({ accel, brake }: { accel: number; brake: boolean }) => (
  <div className="flex flex-col gap-1 w-20">
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-medium text-white/30 w-4">ACC</span>
      <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-400/80"
          style={{
            width: `${Math.min(accel, 100)}%`,
            transition: 'width 0.1s linear',
          }}
        />
      </div>
    </div>
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-medium text-white/30 w-4">BRK</span>
      <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${brake ? 'bg-red-400/80' : 'bg-transparent'}`}
          style={{
            width: brake ? '100%' : '0%',
            transition: 'width 0.1s linear',
          }}
        />
      </div>
    </div>
  </div>
);

const AutopilotStatus = ({ state, left, right }: { state: number; left: boolean; right: boolean }) => {
  const label = AUTOPILOT_LABELS[state] || 'Manual';
  const colorMap: Record<number, string> = {
    0: 'text-white/30',
    1: 'text-blue-400',
    2: 'text-blue-300',
    3: 'text-emerald-400',
  };

  return (
    <div className="flex flex-col items-center gap-[2px]">
      <span className={`text-[10px] font-semibold tracking-wide uppercase w-14 text-center ${colorMap[state] || colorMap[0]}`}>
        {label}
      </span>
      <div className="flex gap-2.5 items-center">
        <span className={`text-xs transition-opacity ${left ? 'text-amber-400 animate-pulse' : 'text-white/10'}`}>◀</span>
        <span className={`text-xs transition-opacity ${right ? 'text-amber-400 animate-pulse' : 'text-white/10'}`}>▶</span>
      </div>
    </div>
  );
};

const GForceMeter = ({ x, y }: { x: number; y: number }) => {
  const gX = accelToG(x);
  const gY = accelToG(y);
  const clampedX = Math.max(-2, Math.min(2, gX));
  const clampedY = Math.max(-2, Math.min(2, gY));
  const dotX = 30 + clampedX * 12;
  const dotY = 30 - clampedY * 12;
  const magnitude = Math.sqrt(gX * gX + gY * gY);
  const dotColor = magnitude > 0.8 ? '#ef4444' : magnitude > 0.3 ? '#22c55e' : '#94a3b8';

  return (
    <div className="flex flex-col items-center gap-0">
      <svg viewBox="0 0 60 60" className="w-11 h-11 flex-shrink-0">
        <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-white/10" />
        <circle cx="30" cy="30" r="13" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-white/8" />
        <line x1="4" y1="30" x2="56" y2="30" stroke="currentColor" strokeWidth="0.3" className="text-white/8" />
        <line x1="30" y1="4" x2="30" y2="56" stroke="currentColor" strokeWidth="0.3" className="text-white/8" />
        <circle cx={dotX} cy={dotY} r="6" fill={dotColor} opacity="0.15">
          <animate attributeName="cx" to={dotX} dur="0.1s" fill="freeze" />
          <animate attributeName="cy" to={dotY} dur="0.1s" fill="freeze" />
        </circle>
        <circle cx={dotX} cy={dotY} r="3.5" fill={dotColor} opacity="0.9">
          <animate attributeName="cx" to={dotX} dur="0.1s" fill="freeze" />
          <animate attributeName="cy" to={dotY} dur="0.1s" fill="freeze" />
        </circle>
      </svg>
      <span className="text-[9px] text-white/30 tabular-nums w-8 text-center">{magnitude.toFixed(1)}g</span>
    </div>
  );
};

const Compass = ({ heading }: { heading: number }) => {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(heading / 45) % 8;

  return (
    <div className="flex flex-col items-center gap-0">
      <svg viewBox="0 0 60 60" className="w-11 h-11 flex-shrink-0">
        <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-white/10" />
        {[0, 90, 180, 270].map((a) => {
          const rad = (a * Math.PI) / 180;
          const x1 = 30 + 23 * Math.sin(rad);
          const y1 = 30 - 23 * Math.cos(rad);
          const x2 = 30 + 26 * Math.sin(rad);
          const y2 = 30 - 26 * Math.cos(rad);
          return (
            <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1" className="text-white/20" />
          );
        })}
        <g style={{ transform: `rotate(${heading}deg)`, transformOrigin: '30px 30px', transition: 'transform 0.1s linear' }}>
          <polygon points="30,8 28,28 32,28" fill="#ef4444" opacity="0.85" />
          <polygon points="30,52 28,32 32,32" fill="currentColor" className="text-white/15" />
        </g>
        <circle cx="30" cy="30" r="2" fill="currentColor" className="text-white/30" />
      </svg>
      <span className="text-[9px] text-white/30 tabular-nums w-12 text-center">{String(Math.round(heading)).padStart(3, '\u2007')}° {cardinals[idx].padEnd(2, '\u2007')}</span>
    </div>
  );
};

const Divider = () => <div className="w-px h-9 bg-white/8" />;

// --- Drag position persistence ---

const STORAGE_KEY = 'sentrycam-telemetry-pos';

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

// --- Main Dashboard ---

export const TelemetryDashboard = ({ sei, visible }: TelemetryDashboardProps) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const rafId = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = loadPosition();
    if (saved) setPos(saved);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const el = containerRef.current;
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
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  if (!visible || !sei) return null;

  const normalizedHeading = useMemo(() => {
    let h = parseFloat(String(sei.heading_deg));
    if (!Number.isFinite(h)) h = 0;
    return ((h % 360) + 360) % 360;
  }, [sei.heading_deg]);

  const style: React.CSSProperties = pos
    ? { position: 'absolute', left: pos.x, top: pos.y }
    : { position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)' };

  return (
    <div ref={containerRef} className="z-30 select-none" style={style}>
      <div
        className="rounded-lg bg-black/70 backdrop-blur-xl border border-white/[0.06] px-4 py-2 shadow-2xl cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        role="toolbar"
        aria-label="Telemetry dashboard — drag to reposition"
      >
        <div className="flex items-center gap-4 pointer-events-none">
          <SteeringWheel angle={sei.steering_wheel_angle || 0} />

          <SpeedCluster mps={sei.vehicle_speed_mps || 0} gear={sei.gear_state || 0} />

          <Divider />

          <PedalBars accel={sei.accelerator_pedal_position || 0} brake={sei.brake_applied || false} />

          <Divider />

          <AutopilotStatus
            state={sei.autopilot_state || 0}
            left={sei.blinker_on_left || false}
            right={sei.blinker_on_right || false}
          />

          <Divider />

          <GForceMeter x={sei.linear_acceleration_mps2_x || 0} y={sei.linear_acceleration_mps2_y || 0} />
          <Compass heading={normalizedHeading} />
        </div>
      </div>
    </div>
  );
};
