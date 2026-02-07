'use client';

import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from 'react';
import {
  createStream,
  loadStream,
  destroyStream,
  showStreamFrame,
  findFrameIndexAtTime,
  getStreamDuration,
  type CameraStream,
} from '@/lib/camera-stream';
import {
  detect,
  drawDetections,
  clearOverlay,
  isModelReady,
} from '@/lib/object-detector';
import type { ClipGroup, CameraKey } from '@/types/video';
import { GRID_LAYOUTS, DEFAULT_LAYOUT } from '@/types/video';

// ---------------------------------------------------------------------------
// Public interface (unchanged — parent page.tsx doesn't need to change)
// ---------------------------------------------------------------------------

export interface VideoPlayerRef {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  toggleMute: () => void;
  getMasterFile: () => File | null;
}

interface VideoPlayerProps {
  group: ClipGroup | null;
  layoutId: string;
  playbackRate: number;
  autoplay: boolean;
  hitboxEnabled: boolean;
  onTimeUpdate: (time: number, duration: number) => void;
  onVideoEnd: () => void;
}

// ---------------------------------------------------------------------------
// Canvas-based CameraView
// ---------------------------------------------------------------------------

const CameraView = ({
  label,
  canvasRef,
  overlayRef,
  isMaster,
  isFocused,
  objectFit,
  onFocus,
}: {
  label: string;
  canvasRef: (el: HTMLCanvasElement | null) => void;
  overlayRef?: (el: HTMLCanvasElement | null) => void;
  isMaster: boolean;
  isFocused: boolean;
  objectFit?: 'cover' | 'contain';
  onFocus: () => void;
}) => (
  <div
    className={`relative group overflow-hidden rounded-lg bg-black cursor-pointer transition-all duration-200 ${
      isFocused ? 'col-span-full row-span-full z-10' : ''
    }`}
    onClick={onFocus}
    tabIndex={0}
    role="button"
    aria-label={`${label} camera${isFocused ? ', click to unfocus' : ', click to focus'}`}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onFocus();
      }
    }}
  >
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ objectFit: objectFit || 'cover' }}
    />
    {overlayRef && (
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ objectFit: objectFit || 'cover' }}
      />
    )}
    <span className="absolute bottom-2 left-2 text-xs font-medium text-white/80 bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm pointer-events-none">
      {label}
    </span>
    {isMaster && (
      <span className="absolute top-2 right-2 text-[10px] font-medium text-white/60 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none">
        master
      </span>
    )}
    {!isFocused && (
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
    )}
  </div>
);

// =====================================================================
// Canvas-based VideoPlayer (VideoDecoder)
// =====================================================================

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  ({ group, layoutId, playbackRate, autoplay, hitboxEnabled, onTimeUpdate, onVideoEnd }, ref) => {
    const streamsRef = useRef<Map<CameraKey, CameraStream>>(new Map());
    const canvasRefs = useRef<Map<CameraKey, HTMLCanvasElement>>(new Map());
    const [loaded, setLoaded] = useState(false);
    const [activeCameras, setActiveCameras] = useState<CameraKey[]>([]);
    const [masterCamera, setMasterCamera] = useState<CameraKey>('front');
    const [focusedCamera, setFocusedCamera] = useState<CameraKey | null>(null);

    // Mutable playback state (refs avoid stale closures in setTimeout)
    const playingRef = useRef(false);
    const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nextFrameTimeRef = useRef(0);
    const currentFrameIndexRef = useRef(0);
    const slaveFrameIndicesRef = useRef<Map<CameraKey, number>>(new Map());
    const playbackRateRef = useRef(playbackRate);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onVideoEndRef = useRef(onVideoEnd);

    // Hitbox detection state
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const hitboxEnabledRef = useRef(hitboxEnabled);
    hitboxEnabledRef.current = hitboxEnabled;

    // Keep refs up to date
    playbackRateRef.current = playbackRate;
    onTimeUpdateRef.current = onTimeUpdate;
    onVideoEndRef.current = onVideoEnd;

    const layout = GRID_LAYOUTS[layoutId] || GRID_LAYOUTS[DEFAULT_LAYOUT];

    // -----------------------------------------------------------------
    // Load streams when group changes
    // -----------------------------------------------------------------
    useEffect(() => {
      if (!group) return;

      let cancelled = false;

      const doLoad = async () => {
        // Destroy previous streams
        streamsRef.current.forEach((s) => destroyStream(s));
        streamsRef.current.clear();
        setLoaded(false);

        // Determine master camera
        const master: CameraKey = group.filesByCamera.has('front') ? 'front'
          : (group.filesByCamera.keys().next().value as CameraKey);

        // Create and load streams in parallel
        const cameras: CameraKey[] = [];
        const loadPromises: Promise<void>[] = [];

        for (const [cam, file] of group.filesByCamera) {
          const canvas = canvasRefs.current.get(cam) || null;
          const stream = createStream(cam, canvas);
          streamsRef.current.set(cam, stream);
          cameras.push(cam);

          // Only master camera parses SEI telemetry
          const isMaster = cam === master;
          loadPromises.push(
            loadStream(stream, file, isMaster ? await getSeiType() : null)
          );
        }

        await Promise.all(loadPromises);
        if (cancelled) return;

        setMasterCamera(master);
        setActiveCameras(cameras);
        setFocusedCamera(null);
        currentFrameIndexRef.current = 0;
        setLoaded(true);

        // Show first frame
        syncAllStreamsToIndex(0);

        // Report initial duration
        const masterStream = streamsRef.current.get(master);
        if (masterStream) {
          const dur = getStreamDuration(masterStream);
          onTimeUpdateRef.current(0, dur / 1000);
        }
      };

      doLoad();

      return () => {
        cancelled = true;
        stopPlayback();
        streamsRef.current.forEach((s) => destroyStream(s));
        streamsRef.current.clear();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group]);

    // Autoplay after loading
    useEffect(() => {
      if (loaded && autoplay) {
        startPlayback();
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, autoplay]);

    // Re-attach canvases to streams when canvas refs change (layout switch)
    useEffect(() => {
      streamsRef.current.forEach((stream, cam) => {
        const canvas = canvasRefs.current.get(cam) || null;
        if (canvas && stream.canvas !== canvas) {
          stream.canvas = canvas;
          stream.ctx = canvas.getContext('2d');
          if (stream.config) {
            canvas.width = stream.config.width;
            canvas.height = stream.config.height;
          }
          // Re-render current frame on the new canvas
          if (stream.frames.length > 0) {
            const masterStream = streamsRef.current.get(masterCamera);
            if (masterStream && masterStream.frames[currentFrameIndexRef.current]) {
              const t = masterStream.frames[currentFrameIndexRef.current].timestamp;
              const idx = findFrameIndexAtTime(stream, t);
              showStreamFrame(stream, idx);
            }
          }
        }
      });
    });

    // -----------------------------------------------------------------
    // Playback scheduler — drift-correcting clock (like teslareplay)
    // -----------------------------------------------------------------

    // Timestamp-based sync — used for initial load and user-initiated seeks.
    // Positions each slave via binary search on timestamp.
    const syncAllStreamsToIndex = useCallback((index: number) => {
      const masterStream = streamsRef.current.get(masterCamera);
      if (!masterStream || !masterStream.frames[index]) return;

      const masterTimestamp = masterStream.frames[index].timestamp;

      // Decode master
      showStreamFrame(masterStream, index);

      // Decode slaves at the matching timestamp
      streamsRef.current.forEach((stream, cam) => {
        if (cam === masterCamera) return;
        if (stream.frames.length === 0) return;
        const slaveIdx = findFrameIndexAtTime(stream, masterTimestamp);
        slaveFrameIndicesRef.current.set(cam, slaveIdx);
        showStreamFrame(stream, slaveIdx);
      });

      // Report time to parent (seconds)
      const duration = getStreamDuration(masterStream) / 1000;
      onTimeUpdateRef.current(masterTimestamp / 1000, duration);
    }, [masterCamera]);

    // Sequential advance — used during playback. All cameras advance by +1
    // frame, keeping every stream on the fast sequential decode path.
    // Drift correction every 30 frames re-syncs slaves by timestamp.
    const advanceAllStreams = useCallback(() => {
      const masterStream = streamsRef.current.get(masterCamera);
      if (!masterStream) return;

      const masterIndex = currentFrameIndexRef.current;
      if (!masterStream.frames[masterIndex]) return;

      const masterTimestamp = masterStream.frames[masterIndex].timestamp;

      // Decode master
      showStreamFrame(masterStream, masterIndex);

      // Advance slaves sequentially
      streamsRef.current.forEach((stream, cam) => {
        if (cam === masterCamera) return;
        if (stream.frames.length === 0) return;

        const prevIdx = slaveFrameIndicesRef.current.get(cam) ?? 0;
        let nextIdx = prevIdx + 1;

        // Clamp to valid range
        if (nextIdx >= stream.frames.length) nextIdx = stream.frames.length - 1;

        // Periodic drift correction: every 30 frames, check timestamp alignment
        if (masterIndex % 30 === 0) {
          const correctIdx = findFrameIndexAtTime(stream, masterTimestamp);
          if (Math.abs(correctIdx - nextIdx) > 1) {
            nextIdx = correctIdx;
          }
        }

        slaveFrameIndicesRef.current.set(cam, nextIdx);
        showStreamFrame(stream, nextIdx);
      });

      // Report time to parent (seconds)
      const duration = getStreamDuration(masterStream) / 1000;
      onTimeUpdateRef.current(masterTimestamp / 1000, duration);
    }, [masterCamera]);

    const playNext = useCallback(() => {
      if (!playingRef.current) return;

      const masterStream = streamsRef.current.get(masterCamera);
      if (!masterStream) return;

      const next = currentFrameIndexRef.current + 1;

      // End of stream
      if (next >= masterStream.frames.length) {
        stopPlayback();
        onVideoEndRef.current();
        return;
      }

      // Backpressure: if decoder queue is backing up, wait
      if (masterStream.decoder && masterStream.decoder.decodeQueueSize > 5) {
        playTimerRef.current = setTimeout(playNext, 5);
        return;
      }

      currentFrameIndexRef.current = next;
      advanceAllStreams();

      // Drift-correcting scheduling
      const frameDur = masterStream.frames[next].duration || 33;
      const scaledDur = frameDur / playbackRateRef.current;

      nextFrameTimeRef.current += scaledDur;
      const now = performance.now();
      let delay = nextFrameTimeRef.current - now;

      // Sync recovery: if we've fallen behind > 100ms, reset clock
      if (delay < -100) {
        nextFrameTimeRef.current = now;
        delay = 0;
      }

      playTimerRef.current = setTimeout(playNext, Math.max(0, delay));
    }, [masterCamera, advanceAllStreams]);

    const startPlayback = useCallback(() => {
      if (playingRef.current) return;
      const masterStream = streamsRef.current.get(masterCamera);
      if (!masterStream || masterStream.frames.length === 0) return;

      playingRef.current = true;
      nextFrameTimeRef.current = performance.now();
      playNext();
    }, [masterCamera, playNext]);

    const stopPlayback = useCallback(() => {
      playingRef.current = false;
      if (playTimerRef.current !== null) {
        clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
      // Flush decoders so the last frame is actually drawn
      streamsRef.current.forEach((stream) => {
        if (stream.decoder && stream.decoder.state === 'configured') {
          stream.decoder.flush().catch(() => {});
        }
      });
    }, []);

    // -----------------------------------------------------------------
    // Imperative API (same interface as before)
    // -----------------------------------------------------------------

    useImperativeHandle(ref, () => ({
      play: () => startPlayback(),
      pause: () => stopPlayback(),
      seek: (time: number) => {
        if (!isFinite(time)) return;
        const masterStream = streamsRef.current.get(masterCamera);
        if (!masterStream) return;

        const timeMs = time * 1000;
        const idx = findFrameIndexAtTime(masterStream, timeMs);
        currentFrameIndexRef.current = idx;
        syncAllStreamsToIndex(idx);

        // Reset scheduling clock if playing
        if (playingRef.current) {
          nextFrameTimeRef.current = performance.now();
        }
      },
      setPlaybackRate: (rate: number) => {
        playbackRateRef.current = rate;
      },
      toggleMute: () => {
        // Canvas rendering has no audio — no-op
      },
      getMasterFile: () => {
        if (!group) return null;
        return group.filesByCamera.get(masterCamera) || null;
      },
    }), [group, masterCamera, startPlayback, stopPlayback, syncAllStreamsToIndex]);

    // Escape to exit focus mode
    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && focusedCamera) setFocusedCamera(null);
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, [focusedCamera]);

    // -----------------------------------------------------------------
    // Hitbox detection loop (chained — runs as fast as hardware allows)
    // -----------------------------------------------------------------
    useEffect(() => {
      if (!hitboxEnabled || !loaded) {
        if (overlayCtxRef.current && overlayCanvasRef.current) {
          clearOverlay(
            overlayCtxRef.current,
            overlayCanvasRef.current.width,
            overlayCanvasRef.current.height,
          );
        }
        return;
      }

      let running = true;

      const runDetection = async () => {
        while (running && hitboxEnabledRef.current) {
          const targetCam = focusedCamera || masterCamera;
          const sourceCanvas = canvasRefs.current.get(targetCam);
          const overlay = overlayCanvasRef.current;
          const ctx = overlayCtxRef.current;

          if (sourceCanvas && overlay && ctx && isModelReady()) {
            if (overlay.width !== sourceCanvas.width || overlay.height !== sourceCanvas.height) {
              overlay.width = sourceCanvas.width;
              overlay.height = sourceCanvas.height;
            }

            const detections = await detect(sourceCanvas);
            if (!running || !hitboxEnabledRef.current) break;

            if (detections.length > 0) {
              drawDetections(ctx, detections, overlay.width, overlay.height);
            } else {
              clearOverlay(ctx, overlay.width, overlay.height);
            }
          } else {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
      };

      runDetection();

      return () => {
        running = false;
        // Clear overlay
        if (overlayCtxRef.current && overlayCanvasRef.current) {
          clearOverlay(
            overlayCtxRef.current,
            overlayCanvasRef.current.width,
            overlayCanvasRef.current.height,
          );
        }
      };
    }, [hitboxEnabled, loaded, focusedCamera, masterCamera]);

    // Overlay canvas ref callback
    const makeOverlayRef = useCallback((el: HTMLCanvasElement | null) => {
      overlayCanvasRef.current = el;
      overlayCtxRef.current = el ? el.getContext('2d') : null;
    }, []);

    // -----------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------

    if (!group || activeCameras.length === 0) return null;

    const activeSlots = layout.slots.filter((slot) => activeCameras.includes(slot.camera));

    const makeCanvasRef = (camera: CameraKey) => (el: HTMLCanvasElement | null) => {
      if (el) {
        canvasRefs.current.set(camera, el);
        // Attach canvas to existing stream
        const stream = streamsRef.current.get(camera);
        if (stream && stream.canvas !== el) {
          stream.canvas = el;
          stream.ctx = el.getContext('2d');
          if (stream.config) {
            el.width = stream.config.width;
            el.height = stream.config.height;
          }
        }
      } else {
        canvasRefs.current.delete(camera);
      }
    };

    // Focus mode
    if (focusedCamera && activeCameras.includes(focusedCamera)) {
      const slot = activeSlots.find((s) => s.camera === focusedCamera);
      if (slot) {
        return (
          <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
            <CameraView
              label={slot.label}
              canvasRef={makeCanvasRef(slot.camera)}
              overlayRef={hitboxEnabled ? makeOverlayRef : undefined}
              isMaster={slot.camera === masterCamera}
              isFocused={true}
              objectFit="contain"
              onFocus={() => setFocusedCamera(null)}
            />
            <button
              className="absolute top-3 left-3 z-20 text-xs text-white/60 bg-black/40 px-2 py-1 rounded backdrop-blur-sm hover:text-white hover:bg-black/60 transition-colors"
              onClick={() => setFocusedCamera(null)}
              aria-label="Exit focus mode"
            >
              ← Back to grid
            </button>
          </div>
        );
      }
    }

    // Immersive / Theater mode
    if (layout.immersive) {
      const mainCamera = activeSlots.find((s) => s.camera === 'front') || activeSlots[0];
      const overlaySlots = activeSlots.filter((s) => s.camera !== mainCamera?.camera);
      const overlayPositions = [
        'top-2 left-2', 'top-2 right-2', 'bottom-2 left-2',
        'bottom-2 left-1/2 -translate-x-1/2', 'bottom-2 right-2',
      ];

      return (
        <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
          {mainCamera && (
            <div className="absolute inset-0 z-0">
              <canvas
                ref={makeCanvasRef(mainCamera.camera)}
                className="w-full h-full"
                style={{ objectFit: 'contain' }}
              />
              {hitboxEnabled && (
                <canvas
                  ref={makeOverlayRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ objectFit: 'contain' }}
                />
              )}
              <span className="absolute bottom-2 left-2 text-xs font-medium text-white/60 bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm pointer-events-none z-20">
                {mainCamera.label}
              </span>
            </div>
          )}
          {overlaySlots.map((slot, i) => {
            if (i >= overlayPositions.length) return null;
            return (
              <div
                key={slot.camera}
                className={`absolute ${overlayPositions[i]} z-10 w-[18%] aspect-video rounded-lg overflow-hidden border border-white/15 bg-black/40 shadow-lg opacity-90 hover:opacity-100 hover:scale-[1.03] hover:z-20 transition-all duration-200 cursor-pointer`}
                onClick={() => setFocusedCamera(slot.camera)}
                role="button"
                aria-label={`Focus ${slot.label} camera`}
              >
                <canvas
                  ref={makeCanvasRef(slot.camera)}
                  className="w-full h-full"
                  style={{ objectFit: 'cover' }}
                />
                <span className="absolute top-1 left-1 text-[8px] font-medium text-white/70 bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none">
                  {slot.label}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    // Standard grid mode
    const columns = activeSlots.length <= 2
      ? activeSlots.length
      : Math.min(layout.columns, activeSlots.length);

    return (
      <div
        className="grid gap-1 rounded-xl overflow-hidden bg-black/40 p-1 h-full"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {activeSlots.map((slot) => (
          <CameraView
            key={slot.camera}
            label={slot.label}
            canvasRef={makeCanvasRef(slot.camera)}
            overlayRef={hitboxEnabled && slot.camera === masterCamera ? makeOverlayRef : undefined}
            isMaster={slot.camera === masterCamera}
            isFocused={false}
            onFocus={() => setFocusedCamera(slot.camera)}
          />
        ))}
      </div>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';

// =====================================================================
// Helper: lazy-load protobuf SeiMetadata type for master camera telemetry
// =====================================================================

let seiTypeCache: unknown = null;

async function getSeiType(): Promise<unknown> {
  if (seiTypeCache) return seiTypeCache;
  try {
    const protobuf = await import('protobufjs');
    const root = await protobuf.load('/dashcam.proto');
    seiTypeCache = root.lookupType('SeiMetadata');
    return seiTypeCache;
  } catch (e) {
    console.warn('Failed to load dashcam.proto for SEI parsing:', e);
    return null;
  }
}
