'use client';

import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from 'react';
import { getVideoFilesForGroup } from '@/lib/video-utils';
import type { ClipGroup, CameraKey } from '@/types/video';
import { GRID_LAYOUTS, DEFAULT_LAYOUT } from '@/types/video';

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
  onTimeUpdate: (time: number, duration: number) => void;
  onVideoEnd: () => void;
}

const CameraView = ({
  label,
  src,
  videoRef,
  isMaster,
  isFocused,
  onFocus,
}: {
  label: string;
  src: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isMaster: boolean;
  isFocused: boolean;
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
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      className="w-full h-full object-cover"
    />
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

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  ({ group, layoutId, playbackRate, autoplay, onTimeUpdate, onVideoEnd }, ref) => {
    const videoRefs = useRef<Map<CameraKey, HTMLVideoElement>>(new Map());
    const [urls, setUrls] = useState<Map<CameraKey, string>>(new Map());
    const [masterCamera, setMasterCamera] = useState<CameraKey>('front');
    const [focusedCamera, setFocusedCamera] = useState<CameraKey | null>(null);
    const urlsRef = useRef<Map<CameraKey, string>>(new Map());

    const layout = GRID_LAYOUTS[layoutId] || GRID_LAYOUTS[DEFAULT_LAYOUT];

    const getActiveVideos = useCallback(
      (): HTMLVideoElement[] => Array.from(videoRefs.current.values()),
      []
    );

    // Load video URLs when group changes
    useEffect(() => {
      if (!group) return;

      // Revoke previous URLs
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));

      const newUrls = getVideoFilesForGroup(group);
      urlsRef.current = newUrls;
      setUrls(newUrls);
      setFocusedCamera(null);

      // Pick master camera
      if (newUrls.has('front')) {
        setMasterCamera('front');
      } else {
        const first = newUrls.keys().next().value;
        if (first) setMasterCamera(first);
      }

      return () => {
        // Only revoke on unmount, not on re-run
        // (re-run revokes at the top of the effect)
      };
    }, [group]);

    // Autoplay: once videos have src and can play, start them
    useEffect(() => {
      if (!autoplay || urls.size === 0) return;

      let cancelled = false;

      const playAll = () => {
        if (cancelled) return;
        Array.from(videoRefs.current.values()).forEach((v) =>
          v.play().catch(() => {})
        );
      };

      // Poll until refs are populated and at least one video is ready
      const poll = setInterval(() => {
        if (cancelled) { clearInterval(poll); return; }

        const videos = Array.from(videoRefs.current.values());
        if (videos.length === 0) return;

        // Check if any video is ready to play
        const ready = videos.some((v) => v.readyState >= 2);
        if (ready) {
          clearInterval(poll);
          playAll();
          return;
        }

        // Attach canplay listener to first video as backup
        const first = videos[0];
        if (first && !first.dataset.autoplayListening) {
          first.dataset.autoplayListening = '1';
          first.addEventListener('canplay', () => {
            clearInterval(poll);
            playAll();
          }, { once: true });
        }
      }, 50);

      // Fallback
      const timeout = setTimeout(() => {
        clearInterval(poll);
        playAll();
      }, 3000);

      return () => {
        cancelled = true;
        clearInterval(poll);
        clearTimeout(timeout);
      };
    }, [urls, autoplay]);

    // Sync playback rate
    useEffect(() => {
      getActiveVideos().forEach((v) => {
        if (!isNaN(playbackRate)) v.playbackRate = playbackRate;
      });
    }, [playbackRate, urls, getActiveVideos]);

    // Master video drives time updates and keeps slave videos in sync.
    // Uses requestVideoFrameCallback for frame-accurate master timing when
    // available (fires exactly when a frame is composited), with rAF fallback.
    // Slave sync uses VPBR (Variable Playback Rate) — gently nudging slave
    // playback rates to converge rather than hard-seeking (which causes stutter).
    useEffect(() => {
      const master = videoRefs.current.get(masterCamera);
      if (!master) return;

      let running = true;
      let rafHandle = 0;
      let rvfcHandle = 0;
      let lastSyncTime = 0;

      // Check for RVFC support without triggering TypeScript type narrowing
      const useRVFC = typeof (master as unknown as Record<string, unknown>).requestVideoFrameCallback === 'function';

      // VPBR sync: adjust slave playback rates to converge on master time.
      // Only hard-seeks as a last resort for extreme drift.
      const syncSlaves = (masterTime: number) => {
        const masterRate = master.playbackRate || 1;
        const driftThreshold = Math.max(0.03, 0.1 / masterRate);

        const now = performance.now();
        const syncInterval = Math.max(30, 100 / masterRate);
        if (now - lastSyncTime < syncInterval) return;
        lastSyncTime = now;

        videoRefs.current.forEach((video, cam) => {
          if (cam === masterCamera) return;
          if (video.paused || video.ended) return;

          const drift = video.currentTime - masterTime; // +ahead, -behind

          if (Math.abs(drift) > 0.5) {
            // Extreme drift — hard seek as last resort
            video.currentTime = masterTime;
            video.playbackRate = masterRate;
          } else if (Math.abs(drift) > driftThreshold) {
            // VPBR: nudge rate to converge. Scale correction with drift size.
            const correction = 1 + Math.sign(-drift) * Math.min(0.05, Math.abs(drift) * 0.5);
            video.playbackRate = masterRate * correction;
          } else if (video.playbackRate !== masterRate) {
            // Back in sync — reset rate
            video.playbackRate = masterRate;
          }
        });
      };

      // requestVideoFrameCallback path: fires per-frame with precise mediaTime
      const rvfcTick = (_now: DOMHighResTimeStamp, metadata: { mediaTime: number }) => {
        if (!running) return;
        const mediaTime = metadata.mediaTime;
        onTimeUpdate(mediaTime, master.duration);
        syncSlaves(mediaTime);
        rvfcHandle = (master as HTMLVideoElement & { requestVideoFrameCallback: (cb: (n: DOMHighResTimeStamp, m: { mediaTime: number }) => void) => number }).requestVideoFrameCallback(rvfcTick);
      };

      // requestAnimationFrame path — used as sole driver when RVFC is
      // unavailable, or as a paused-state updater alongside RVFC.
      const rafTick = () => {
        if (!running) return;
        if (!master.paused && !master.ended && master.readyState >= 2) {
          // When RVFC is active it handles playing-state updates;
          // rAF only fires updates when RVFC is unavailable.
          if (!useRVFC) {
            onTimeUpdate(master.currentTime, master.duration);
            syncSlaves(master.currentTime);
          }
        }
        rafHandle = requestAnimationFrame(rafTick);
      };

      if (useRVFC) {
        rvfcHandle = (master as HTMLVideoElement & { requestVideoFrameCallback: (cb: (n: DOMHighResTimeStamp, m: { mediaTime: number }) => void) => number }).requestVideoFrameCallback(rvfcTick);
      }
      // Always start rAF: sole driver without RVFC, or paused-state fallback with RVFC
      rafHandle = requestAnimationFrame(rafTick);

      const handleEnd = () => onVideoEnd();
      master.addEventListener('ended', handleEnd);

      return () => {
        running = false;
        cancelAnimationFrame(rafHandle);
        if (useRVFC && rvfcHandle) {
          (master as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(rvfcHandle);
        }
        // Reset slave playback rates on cleanup
        videoRefs.current.forEach((video, cam) => {
          if (cam !== masterCamera) {
            try { video.playbackRate = master.playbackRate || 1; } catch {}
          }
        });
        master.removeEventListener('ended', handleEnd);
      };
    }, [masterCamera, onTimeUpdate, onVideoEnd, urls]);

    // Escape key to unfocus
    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && focusedCamera) {
          setFocusedCamera(null);
        }
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, [focusedCamera]);

    // Cleanup URLs on unmount
    useEffect(() => {
      return () => {
        urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      };
    }, []);

    useImperativeHandle(ref, () => ({
      play: () => getActiveVideos().forEach((v) => v.play().catch(() => {})),
      pause: () => getActiveVideos().forEach((v) => v.pause()),
      seek: (time: number) => {
        if (!isFinite(time)) return;
        getActiveVideos().forEach((v) => (v.currentTime = time));
      },
      setPlaybackRate: (rate: number) =>
        getActiveVideos().forEach((v) => (v.playbackRate = rate)),
      toggleMute: () => {
        const videos = getActiveVideos();
        const isMuted = videos.some((v) => v.muted);
        videos.forEach((v) => (v.muted = !isMuted));
      },
      getMasterFile: () => {
        if (!group) return null;
        return group.filesByCamera.get(masterCamera) || null;
      },
    }));

    if (!group || urls.size === 0) return null;

    const activeSlots = layout.slots.filter((slot) => urls.has(slot.camera));

    const makeVideoRef = (camera: CameraKey) => ({
      get current() {
        return videoRefs.current.get(camera) || null;
      },
      set current(el: HTMLVideoElement | null) {
        if (el) videoRefs.current.set(camera, el);
        else videoRefs.current.delete(camera);
      },
    });

    // Focus mode: show only focused camera full-size
    if (focusedCamera && urls.has(focusedCamera)) {
      const slot = activeSlots.find((s) => s.camera === focusedCamera);
      if (slot) {
        const url = urls.get(slot.camera)!;
        return (
          <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
            <CameraView
              label={slot.label}
              src={url}
              isMaster={slot.camera === masterCamera}
              isFocused={true}
              onFocus={() => setFocusedCamera(null)}
              videoRef={makeVideoRef(slot.camera)}
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

      // Position overlays: TL, TR, BL, BC, BR
      const overlayPositions = [
        'top-2 left-2',
        'top-2 right-2',
        'bottom-2 left-2',
        'bottom-2 left-1/2 -translate-x-1/2',
        'bottom-2 right-2',
      ];

      return (
        <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
          {/* Main camera — full screen */}
          {mainCamera && urls.get(mainCamera.camera) && (
            <div className="absolute inset-0 z-0">
              <video
                ref={(el) => {
                  if (el) videoRefs.current.set(mainCamera.camera, el);
                  else videoRefs.current.delete(mainCamera.camera);
                }}
                src={urls.get(mainCamera.camera)}
                muted
                playsInline
                className="w-full h-full object-contain"
              />
              <span className="absolute bottom-2 left-2 text-xs font-medium text-white/60 bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm pointer-events-none z-20">
                {mainCamera.label}
              </span>
            </div>
          )}

          {/* PiP overlays */}
          {overlaySlots.map((slot, i) => {
            const url = urls.get(slot.camera);
            if (!url || i >= overlayPositions.length) return null;
            const posClass = overlayPositions[i];

            return (
              <div
                key={slot.camera}
                className={`absolute ${posClass} z-10 w-[18%] aspect-video rounded-lg overflow-hidden border border-white/15 bg-black/40 shadow-lg opacity-90 hover:opacity-100 hover:scale-[1.03] hover:z-20 transition-all duration-200 cursor-pointer`}
                onClick={() => setFocusedCamera(slot.camera)}
                role="button"
                aria-label={`Focus ${slot.label} camera`}
              >
                <video
                  ref={(el) => {
                    if (el) videoRefs.current.set(slot.camera, el);
                    else videoRefs.current.delete(slot.camera);
                  }}
                  src={url}
                  muted
                  playsInline
                  className="w-full h-full object-cover"
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
    const columns =
      activeSlots.length <= 2
        ? activeSlots.length
        : Math.min(layout.columns, activeSlots.length);

    return (
      <div
        className="grid gap-1 rounded-xl overflow-hidden bg-black/40 p-1 h-full"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {activeSlots.map((slot) => {
          const url = urls.get(slot.camera);
          if (!url) return null;

          return (
            <CameraView
              key={slot.camera}
              label={slot.label}
              src={url}
              isMaster={slot.camera === masterCamera}
              isFocused={false}
              onFocus={() => setFocusedCamera(slot.camera)}
              videoRef={makeVideoRef(slot.camera)}
            />
          );
        })}
      </div>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';
