// @ts-nocheck — dashcam-mp4.js is untyped
import { DashcamMP4 } from './dashcam-mp4';

export interface SeiMetadata {
  version: number;
  gear_state: number; // 0=P, 1=D, 2=R, 3=N
  frame_seq_no: number;
  vehicle_speed_mps: number;
  accelerator_pedal_position: number;
  steering_wheel_angle: number;
  blinker_on_left: boolean;
  blinker_on_right: boolean;
  brake_applied: boolean;
  autopilot_state: number; // 0=None, 1=FSD, 2=AP, 3=TACC
  latitude_deg: number;
  longitude_deg: number;
  heading_deg: number;
  linear_acceleration_mps2_x: number;
  linear_acceleration_mps2_y: number;
  linear_acceleration_mps2_z: number;
}

export interface TelemetryFrame {
  index: number;
  timestamp: number; // ms
  duration: number; // ms
  sei: SeiMetadata | null;
}

export const GEAR_LABELS: Record<number, string> = {
  0: 'P',
  1: 'D',
  2: 'R',
  3: 'N',
};

export const AUTOPILOT_LABELS: Record<number, string> = {
  0: 'Manual',
  1: 'FSD',
  2: 'Autosteer',
  3: 'TACC',
};

let SeiMetadataType: any = null;
let protobufModule: any = null;

/** Initialize protobuf type from .proto file */
export const initProtobuf = async (): Promise<any> => {
  if (SeiMetadataType) return SeiMetadataType;

  // Dynamic import to avoid SSR issues
  if (!protobufModule) {
    protobufModule = await import('protobufjs');
  }

  const response = await fetch('/dashcam.proto');
  if (!response.ok) {
    throw new Error(`Failed to fetch dashcam.proto: ${response.status}`);
  }
  const protoText = await response.text();

  // protobufjs exports .parse on the default/module level
  const parse = protobufModule.parse || protobufModule.default?.parse;
  if (!parse) {
    throw new Error('protobufjs parse function not found');
  }

  const root = parse(protoText, { keepCase: true }).root;
  SeiMetadataType = root.lookupType('SeiMetadata');
  return SeiMetadataType;
};

/** Parse an MP4 file and extract telemetry frames */
export const parseTelemetry = async (
  file: File
): Promise<TelemetryFrame[]> => {
  const SeiType = await initProtobuf();
  const buffer = await file.arrayBuffer();
  const mp4 = new DashcamMP4(buffer);

  try {
    const frames = mp4.parseFrames(SeiType);
    return frames.map((f: any) => ({
      index: f.index,
      timestamp: f.timestamp,
      duration: f.duration,
      sei: f.sei ? toPlainSei(f.sei) : null,
    }));
  } catch (err) {
    console.warn('[SentryCam] Failed to parse telemetry:', err);
    return [];
  }
};

/** Convert protobuf message to a plain JS object for React state */
const toPlainSei = (sei: any): SeiMetadata => ({
  version: Number(sei.version) || 0,
  gear_state: Number(sei.gear_state) || 0,
  frame_seq_no: Number(sei.frame_seq_no) || 0,
  vehicle_speed_mps: Number(sei.vehicle_speed_mps) || 0,
  accelerator_pedal_position: Number(sei.accelerator_pedal_position) || 0,
  steering_wheel_angle: Number(sei.steering_wheel_angle) || 0,
  blinker_on_left: Boolean(sei.blinker_on_left),
  blinker_on_right: Boolean(sei.blinker_on_right),
  brake_applied: Boolean(sei.brake_applied),
  autopilot_state: Number(sei.autopilot_state) || 0,
  latitude_deg: Number(sei.latitude_deg) || 0,
  longitude_deg: Number(sei.longitude_deg) || 0,
  heading_deg: Number(sei.heading_deg) || 0,
  linear_acceleration_mps2_x: Number(sei.linear_acceleration_mps2_x) || 0,
  linear_acceleration_mps2_y: Number(sei.linear_acceleration_mps2_y) || 0,
  linear_acceleration_mps2_z: Number(sei.linear_acceleration_mps2_z) || 0,
});

/** Find the telemetry frame closest to a given time (ms) */
export const findFrameAtTime = (
  frames: TelemetryFrame[],
  timeMs: number
): TelemetryFrame | null => {
  if (frames.length === 0) return null;

  let lo = 0;
  let hi = frames.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestamp <= timeMs) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return hi >= 0 ? frames[hi] : frames[0];
};

/** Check if GPS coordinates are valid */
export const hasValidGps = (sei: SeiMetadata | null): boolean => {
  if (!sei) return false;
  const { latitude_deg, longitude_deg } = sei;
  return (
    Number.isFinite(latitude_deg) &&
    Number.isFinite(longitude_deg) &&
    !(latitude_deg === 0 && longitude_deg === 0) &&
    Math.abs(latitude_deg) <= 90 &&
    Math.abs(longitude_deg) <= 180
  );
};

/** Extract GPS path from telemetry frames */
export const extractGpsPath = (
  frames: TelemetryFrame[]
): [number, number][] => {
  const path: [number, number][] = [];
  for (const frame of frames) {
    if (frame.sei && hasValidGps(frame.sei)) {
      path.push([frame.sei.latitude_deg, frame.sei.longitude_deg]);
    }
  }
  return path;
};

/** Convert m/s to MPH */
export const mpsToMph = (mps: number): number => mps * 2.23694;

/** Convert acceleration to G-force */
export const accelToG = (mps2: number): number => mps2 / 9.81;
