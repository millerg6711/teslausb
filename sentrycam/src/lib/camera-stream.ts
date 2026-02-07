/**
 * Camera Stream — WebCodecs VideoDecoder + Canvas decode pipeline.
 * Port of teslareplay's multi-cam architecture to TypeScript.
 *
 * Each camera gets its own CameraStream with an independent VideoDecoder,
 * canvas context, frame array, and pending-frame state.
 */

import { DashcamMP4 } from './dashcam-mp4';
import type { CameraKey } from '@/types/video';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoFrame {
  index: number;
  timestamp: number; // cumulative ms
  duration: number; // ms
  keyframe: boolean;
  data: Uint8Array;
  sps: Uint8Array;
  pps: Uint8Array;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sei: any | null;
}

export interface Mp4Config {
  width: number;
  height: number;
  codec: string;
  sps: Uint8Array;
  pps: Uint8Array;
  timescale: number;
  durations: number[];
  avcCData: Uint8Array; // raw avcC box content for VideoDecoder description
}

export interface CameraStream {
  camera: CameraKey;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  mp4: DashcamMP4 | null;
  config: Mp4Config | null;
  frames: VideoFrame[];
  timestamps: number[]; // ms, for binary search
  decoder: VideoDecoder | null;
  decoding: boolean;
  pendingFrame: number | null;
  lastDecodedFrameIndex: number;
  seekTargetTimestamp: number | null;
}

// ---------------------------------------------------------------------------
// Stream lifecycle
// ---------------------------------------------------------------------------

export function createStream(camera: CameraKey, canvas: HTMLCanvasElement | null): CameraStream {
  return {
    camera,
    canvas,
    ctx: canvas?.getContext('2d') ?? null,
    mp4: null,
    config: null,
    frames: [],
    timestamps: [],
    decoder: null,
    decoding: false,
    pendingFrame: null,
    lastDecodedFrameIndex: -1,
    seekTargetTimestamp: null,
  };
}

/**
 * Load a camera's MP4 file, parse frames, and size the canvas.
 * @param parseSei - protobuf SeiMetadata type (only for master camera)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadStream(stream: CameraStream, file: File, parseSei: any = null): Promise<void> {
  const buffer = await file.arrayBuffer();
  const mp4 = new DashcamMP4(buffer);
  const config = mp4.getConfig() as Mp4Config;
  const frames = mp4.parseFrames(parseSei) as VideoFrame[];

  stream.mp4 = mp4;
  stream.config = config;
  stream.frames = frames;
  stream.timestamps = frames.map((f: VideoFrame) => f.timestamp);
  stream.lastDecodedFrameIndex = -1;
  stream.seekTargetTimestamp = null;

  if (stream.canvas) {
    stream.canvas.width = config.width;
    stream.canvas.height = config.height;
  }
}

export function destroyStream(stream: CameraStream): void {
  if (stream.decoder && stream.decoder.state !== 'closed') {
    try { stream.decoder.close(); } catch { /* ignore */ }
  }
  stream.decoder = null;
  stream.mp4 = null;
  stream.config = null;
  stream.frames = [];
  stream.timestamps = [];
  stream.decoding = false;
  stream.pendingFrame = null;
  stream.lastDecodedFrameIndex = -1;
  stream.seekTargetTimestamp = null;
}

// ---------------------------------------------------------------------------
// Chunk creation (Annex B wrapping)
// ---------------------------------------------------------------------------

function createChunk(_stream: CameraStream, frame: VideoFrame): EncodedVideoChunk {
  // AVC format: 4-byte big-endian length prefix + NAL unit data.
  // SPS/PPS are provided via the `description` field in decoder config,
  // so we only need the slice NAL unit here.
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, frame.data.length);
  const data = DashcamMP4.concat(lenBuf, frame.data);

  return new EncodedVideoChunk({
    type: frame.keyframe ? 'key' : 'delta',
    timestamp: frame.timestamp * 1000, // ms → µs for WebCodecs
    data,
  });
}

// ---------------------------------------------------------------------------
// Output handler — draws decoded VideoFrame to canvas
// ---------------------------------------------------------------------------

function handleOutput(stream: CameraStream, frame: globalThis.VideoFrame): void {
  const frameTsMs = frame.timestamp / 1000; // µs → ms
  let shouldDraw = true;

  // During seeks, suppress intermediate frames (only draw the target)
  if (stream.seekTargetTimestamp != null) {
    if (Math.abs(frameTsMs - stream.seekTargetTimestamp) > 0.01) {
      shouldDraw = false;
    } else {
      stream.seekTargetTimestamp = null;
    }
  }

  if (shouldDraw && stream.ctx) {
    stream.ctx.drawImage(frame, 0, 0);
  }

  frame.close(); // Release GPU-backed VideoFrame
}

// ---------------------------------------------------------------------------
// Ensure decoder is ready
// ---------------------------------------------------------------------------

function ensureDecoder(stream: CameraStream): VideoDecoder {
  if (!stream.decoder || stream.decoder.state === 'closed') {
    stream.decoder = new VideoDecoder({
      output: (frame) => handleOutput(stream, frame),
      error: (e) => {
        console.error(`[${stream.camera}] VideoDecoder error:`, e);
        stream.decoder = null;
      },
    });
  }

  if (stream.decoder.state === 'unconfigured') {
    const config = stream.config!;
    stream.decoder.configure({
      codec: config.codec,
      codedWidth: config.width,
      codedHeight: config.height,
      description: config.avcCData,
    });
  }

  return stream.decoder;
}

// ---------------------------------------------------------------------------
// Decode pipeline — sequential vs seek
// ---------------------------------------------------------------------------

function decodeStreamFrame(stream: CameraStream, index: number): void {
  stream.decoding = true;
  try {
    if (!stream.frames[index]) return;
    const targetFrame = stream.frames[index];
    const decoder = ensureDecoder(stream);

    // Sequential requires a previously decoded frame (lastDecodedFrameIndex >= 0)
    // and that it's exactly the prior frame index.
    const isSequential =
      stream.lastDecodedFrameIndex >= 0 &&
      stream.lastDecodedFrameIndex === index - 1;

    if (isSequential) {
      // Fast path: just push one chunk — decoder is already warm
      stream.seekTargetTimestamp = null;
      decoder.decode(createChunk(stream, targetFrame));
      stream.lastDecodedFrameIndex = index;
    } else {
      // Seek path: reset, reconfigure, decode from nearest keyframe through target.
      // No flush() — the decoder stays warm so the next sequential frame can be
      // decoded as a delta without needing another keyframe.
      decoder.reset();
      const config = stream.config!;
      decoder.configure({
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
        description: config.avcCData,
      });

      // Walk back to nearest keyframe
      let keyIdx = index;
      while (keyIdx > 0 && !stream.frames[keyIdx].keyframe) keyIdx--;

      // Only draw the final frame (suppress intermediates via seekTargetTimestamp)
      stream.seekTargetTimestamp = targetFrame.timestamp;

      for (let i = keyIdx; i <= index; i++) {
        decoder.decode(createChunk(stream, stream.frames[i]));
      }

      stream.lastDecodedFrameIndex = index;
    }
  } catch (e) {
    if ((e as DOMException)?.name !== 'AbortError') {
      console.error(`[${stream.camera}] Decode error:`, e);
    }
  } finally {
    stream.decoding = false;

    // If a newer frame was requested while we were decoding, handle it now.
    // This naturally implements frame dropping under load (latest-wins).
    if (stream.pendingFrame !== null) {
      const next = stream.pendingFrame;
      stream.pendingFrame = null;
      decodeStreamFrame(stream, next);
    }
  }
}

// ---------------------------------------------------------------------------
// Public: request a frame to be shown
// ---------------------------------------------------------------------------

export function showStreamFrame(stream: CameraStream, index: number): void {
  if (!stream.frames[index]) return;

  // Already showing this frame — skip redundant decode
  if (index === stream.lastDecodedFrameIndex && !stream.decoding) return;

  if (stream.decoding) {
    // Decoder busy — queue as pending (latest-wins, natural frame dropping)
    stream.pendingFrame = index;
  } else {
    decodeStreamFrame(stream, index);
  }
}

// ---------------------------------------------------------------------------
// Binary search — find frame index at a given timestamp (ms)
// ---------------------------------------------------------------------------

export function findFrameIndexAtTime(stream: CameraStream, timeMs: number): number {
  const ts = stream.timestamps;
  if (!ts.length) return 0;

  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ts[mid] <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Utility: total duration of a stream in ms
// ---------------------------------------------------------------------------

export function getStreamDuration(stream: CameraStream): number {
  if (stream.frames.length === 0) return 0;
  const last = stream.frames[stream.frames.length - 1];
  return last.timestamp + last.duration;
}

