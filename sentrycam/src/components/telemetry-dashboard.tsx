'use client';

import { useMemo } from 'react';
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

// --- Sub-components (compact for navbar) ---

const SpeedCluster = ({ mps, gear }: { mps: number; gear: number }) => {
  const mph = Math.max(0, mpsToMph(mps));
  const whole = Math.floor(mph);
  const decimal = (mph % 1).toFixed(1).slice(1); // ".X"
  const gears = [0, 2, 3, 1]; // P R N D

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-baseline gap-0">
        <span className="text-xl font-semibold tabular-nums tracking-tight text-white leading-none text-right min-w-[1.5rem]">
          {whole}
        </span>
        <span className="text-sm font-medium tabular-nums text-white/50 leading-none w-[14px]">
          {decimal}
        </span>
        <span className="text-[9px] font-medium text-white/30 ml-1 self-end mb-[1px]">
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
              className={`text-[8px] font-semibold w-[14px] h-[14px] flex items-center justify-center rounded transition-colors ${
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

const SteeringWheel = ({ angle }: { angle: number }) => (
  <div
    className="w-8 h-8 flex-shrink-0"
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
  <div className="flex flex-col gap-0.5 w-14">
    <div className="flex items-center gap-1">
      <span className="text-[7px] font-medium text-white/30 w-3">A</span>
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
    <div className="flex items-center gap-1">
      <span className="text-[7px] font-medium text-white/30 w-3">B</span>
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
    <div className="flex items-center gap-1.5">
      <span className={`text-[8px] font-semibold tracking-wide uppercase w-10 text-center ${colorMap[state] || colorMap[0]}`}>
        {label}
      </span>
      <div className="flex gap-1 items-center">
        <span className={`text-[10px] transition-opacity ${left ? 'text-amber-400 animate-pulse' : 'text-white/10'}`}>◀</span>
        <span className={`text-[10px] transition-opacity ${right ? 'text-amber-400 animate-pulse' : 'text-white/10'}`}>▶</span>
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
    <div className="flex items-center gap-0.5">
      <svg viewBox="0 0 60 60" className="w-8 h-8 flex-shrink-0">
        <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-white/10" />
        <circle cx="30" cy="30" r="13" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-white/8" />
        <line x1="4" y1="30" x2="56" y2="30" stroke="currentColor" strokeWidth="0.3" className="text-white/8" />
        <line x1="30" y1="4" x2="30" y2="56" stroke="currentColor" strokeWidth="0.3" className="text-white/8" />
        <circle cx={dotX} cy={dotY} r="6" fill={dotColor} opacity="0.15" />
        <circle cx={dotX} cy={dotY} r="3.5" fill={dotColor} opacity="0.9" />
      </svg>
      <span className="text-[8px] text-white/30 tabular-nums w-6">{magnitude.toFixed(1)}g</span>
    </div>
  );
};

const Compass = ({ heading }: { heading: number }) => {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(heading / 45) % 8;

  return (
    <div className="flex items-center gap-0.5">
      <svg viewBox="0 0 60 60" className="w-8 h-8 flex-shrink-0">
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
      <span className="text-[8px] text-white/30 tabular-nums w-8">{String(Math.round(heading)).padStart(3, '\u2007')}° {cardinals[idx]}</span>
    </div>
  );
};

const Divider = () => <div className="w-px h-6 bg-border/50" />;

// --- Main Dashboard (inline, fits in navbar) ---

export const TelemetryDashboard = ({ sei, visible }: TelemetryDashboardProps) => {
  if (!visible || !sei) return null;

  const normalizedHeading = useMemo(() => {
    let h = parseFloat(String(sei.heading_deg));
    if (!Number.isFinite(h)) h = 0;
    return ((h % 360) + 360) % 360;
  }, [sei.heading_deg]);

  return (
    <div className="flex items-center gap-3">
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
  );
};
