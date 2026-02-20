'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { VideoPlayer, type VideoPlayerRef } from '@/components/video-player';
import { VideoControls } from '@/components/video-controls';
import { ClipBrowser } from '@/components/clip-browser';
import { TelemetryDashboard } from '@/components/telemetry-dashboard';
import dynamic from 'next/dynamic';
import type { MiniMapRef } from '@/components/mini-map';

const MiniMap = dynamic(() => import('@/components/mini-map').then((m) => m.MiniMap), {
  ssr: false,
});
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { buildClipLibrary } from '@/lib/video-utils';
import {
  parseTelemetry,
  findFrameAtTime,
  extractGpsPath,
  hasValidGps,
  type TelemetryFrame,
  type SeiMetadata,
} from '@/lib/telemetry';
import {
  saveDirectoryHandle,
  loadDirectoryHandle,
  clearDirectoryHandle,
  readFilesFromHandle,
  hasDirectoryPickerSupport,
} from '@/lib/fs-persist';
import { FolderOpen, FileVideo, Shield, Upload, RotateCcw, PanelRightOpen, PanelRightClose } from 'lucide-react';
import type { VideoState } from '@/types/video';
import { DEFAULT_LAYOUT } from '@/types/video';

export default function Home() {
  const [videoState, setVideoState] = useState<VideoState>({
    library: null,
    selectedGroupId: '',
    playbackRate: 1,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  });

  const [layoutId, setLayoutId] = useState(DEFAULT_LAYOUT);
  const [autoplay, setAutoplay] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [savedFolderName, setSavedFolderName] = useState<string | null>(null);

  // Telemetry state — use a ref for frames so the time handler can read it directly
  const telemetryFramesRef = useRef<TelemetryFrame[]>([]);
  const [hasTelemetry, setHasTelemetry] = useState(false);
  const [currentSei, setCurrentSei] = useState<SeiMetadata | null>(null);
  const [gpsPath, setGpsPath] = useState<[number, number][]>([]);
  const [mapVisible, setMapVisibleRaw] = useState(() => {
    try { const v = localStorage.getItem('sentrycam-map-vis'); return v !== '0'; } catch { return true; }
  });
  const [sidebarOpen, setSidebarOpenRaw] = useState(() => {
    try { const v = localStorage.getItem('sentrycam-sidebar-vis'); return v !== '0'; } catch { return true; }
  });
  // Wrapped setters that persist to localStorage
  const setMapVisible = useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    setMapVisibleRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('sentrycam-map-vis', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);
  const setSidebarOpen = useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    setSidebarOpenRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('sentrycam-sidebar-vis', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);
  const videoPlayerRef = useRef<VideoPlayerRef>(null);
  const miniMapRef = useRef<MiniMapRef>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse telemetry when group changes
  const parseTelemetryForGroup = useCallback(async (masterFile: File | null) => {
    if (!masterFile) {
      telemetryFramesRef.current = [];
      setHasTelemetry(false);
      setCurrentSei(null);
      setGpsPath([]);
      return;
    }

    try {
      const frames = await parseTelemetry(masterFile);
      telemetryFramesRef.current = frames;
      const has = frames.length > 0 && frames.some((f) => f.sei !== null);
      setHasTelemetry(has);
      setGpsPath(extractGpsPath(frames));
      if (frames.length > 0 && frames[0].sei) {
        setCurrentSei(frames[0].sei);
      }
    } catch (err) {
      console.warn('[SentryCam] Telemetry parse error:', err);
      telemetryFramesRef.current = [];
      setHasTelemetry(false);
      setCurrentSei(null);
      setGpsPath([]);
    }
  }, []);

  /** Load files from a FileSystemDirectoryHandle (persistent) */
  const loadFromHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      setIsLoading(true);
      try {
        // Verify permission (requestPermission is not in all TS defs)
        const perm = await (handle as any).requestPermission({ mode: 'read' });
        if (perm !== 'granted') {
          setIsLoading(false);
          return;
        }

        const files = await readFilesFromHandle(handle);
        if (files.length > 0) {
          await saveDirectoryHandle(handle);
          setSavedFolderName(handle.name);
          await loadFilesInternal(files);
        }
      } catch (err) {
        console.warn('[SentryCam] Failed to load from handle:', err);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /** Open system directory picker (File System Access API) */
  const pickerActiveRef = useRef(false);
  const handlePickDirectory = useCallback(async () => {
    if (!hasDirectoryPickerSupport() || pickerActiveRef.current) return;
    pickerActiveRef.current = true;
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
      await loadFromHandle(handle);
    } catch (err: any) {
      // User cancelled the picker or it was already active
      if (err?.name !== 'AbortError' && err?.name !== 'NotAllowedError') {
        console.warn('[SentryCam] Directory picker error:', err);
      }
    } finally {
      pickerActiveRef.current = false;
    }
  }, [loadFromHandle]);

  /** Reopen the last saved directory */
  const handleReopenLast = useCallback(async () => {
    const handle = await loadDirectoryHandle();
    if (handle) {
      await loadFromHandle(handle);
    }
  }, [loadFromHandle]);

  // On mount: check if we have a saved directory handle (show Reopen button)
  // Don't auto-load — requestPermission requires a user gesture.
  useEffect(() => {
    loadDirectoryHandle().then((handle) => {
      if (handle) {
        setSavedFolderName(handle.name);
      }
    });
  }, []);

  const loadFilesInternal = useCallback(async (files: File[]) => {
    const library = await buildClipLibrary(files);
    if (library.clipGroups.length === 0) return;

    const firstGroup = library.clipGroups[0];
    setVideoState({
      library,
      selectedGroupId: firstGroup.id,
      playbackRate: 1,
      isPlaying: autoplay,
      currentTime: 0,
      duration: 0,
    });
    setLayoutId(DEFAULT_LAYOUT);
    telemetryFramesRef.current = [];
    setHasTelemetry(false);
    setCurrentSei(null);
  }, []);

  // Parse telemetry after group selection
  useEffect(() => {
    if (!videoState.library || !videoState.selectedGroupId) return;
    const group = videoState.library.clipGroupById.get(videoState.selectedGroupId);
    if (!group) return;

    // Use front camera as master for telemetry, fallback to first available
    const masterFile =
      group.filesByCamera.get('front') ||
      group.filesByCamera.values().next().value ||
      null;

    parseTelemetryForGroup(masterFile);
  }, [videoState.selectedGroupId, videoState.library, parseTelemetryForGroup]);

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;
      loadFilesInternal(Array.from(files));
    },
    [loadFilesInternal]
  );

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const items = e.dataTransfer.items;
      const files: File[] = [];

      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length > 0) {
        const readEntry = async (entry: FileSystemEntry, path: string): Promise<void> => {
          if (entry.isFile) {
            const fileEntry = entry as FileSystemFileEntry;
            const file = await new Promise<File>((resolve) => fileEntry.file(resolve));
            const lower = file.name.toLowerCase();
            if (lower.endsWith('.mp4') || lower.endsWith('.json') || lower.endsWith('.png')) {
              Object.defineProperty(file, '_teslaPath', {
                value: path + file.name,
                writable: false,
              });
              files.push(file);
            }
          } else if (entry.isDirectory) {
            const dirEntry = entry as FileSystemDirectoryEntry;
            const reader = dirEntry.createReader();
            // Read in batches (readEntries can return partial results)
            let batch: FileSystemEntry[] = [];
            do {
              batch = await new Promise<FileSystemEntry[]>((resolve) =>
                reader.readEntries(resolve)
              );
              for (const sub of batch) {
                await readEntry(sub, path + entry.name + '/');
              }
            } while (batch.length > 0);
          }
        };

        for (const entry of entries) {
          await readEntry(entry, '');
        }
      } else {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          files.push(e.dataTransfer.files[i]);
        }
      }

      if (files.length > 0) {
        loadFilesInternal(files);
      }
    },
    [loadFilesInternal]
  );

  const handleGroupSelect = useCallback(
    (groupId: string) => {
      if (!videoState.library) return;
      const group = videoState.library.clipGroupById.get(groupId);
      if (!group) return;

      setVideoState((prev) => ({
        ...prev,
        selectedGroupId: groupId,
        isPlaying: autoplay,
        currentTime: 0,
        duration: 0,
      }));
      // Keep current layout (e.g. immersive/theater) — don't reset on clip change
    },
    [videoState.library]
  );

  const handlePlayPause = useCallback(() => {
    if (!videoPlayerRef.current) return;

    if (videoState.isPlaying) {
      videoPlayerRef.current.pause();
      setVideoState((prev) => ({ ...prev, isPlaying: false }));
    } else {
      videoPlayerRef.current.play();
      setVideoState((prev) => ({ ...prev, isPlaying: true }));
    }
  }, [videoState.isPlaying]);

  const handlePlaybackRateChange = useCallback((rate: number) => {
    videoPlayerRef.current?.setPlaybackRate(rate);
    setVideoState((prev) => ({ ...prev, playbackRate: rate }));
  }, []);

  const handleSeek = useCallback((time: number) => {
    videoPlayerRef.current?.seek(time);
  }, []);

  // Throttle seek bar updates (~15fps) while keeping telemetry at full rAF rate
  const lastUiUpdate = useRef(0);

  const handleTimeUpdate = useCallback((time: number, duration: number) => {
    const now = performance.now();

    // Update seek bar / UI state at a throttled rate (every ~66ms)
    if (now - lastUiUpdate.current > 66) {
      lastUiUpdate.current = now;
      setVideoState((prev) => ({ ...prev, currentTime: time, duration }));
    }

    // Telemetry: update every frame for smooth animations
    const frames = telemetryFramesRef.current;
    if (frames.length > 0) {
      const timeMs = time * 1000;
      const frame = findFrameAtTime(frames, timeMs);
      if (frame?.sei) {
        setCurrentSei(frame.sei);

        // Imperatively push GPS position to the map
        if (
          frame.sei.latitude_deg &&
          frame.sei.longitude_deg &&
          hasValidGps(frame.sei)
        ) {
          miniMapRef.current?.updateMarker(
            frame.sei.latitude_deg,
            frame.sei.longitude_deg
          );
        }
      }
    }
  }, []);

  const handleVideoEnd = useCallback(() => {
    if (!videoState.library) return;

    const currentIdx = videoState.library.clipGroups.findIndex(
      (g) => g.id === videoState.selectedGroupId
    );
    if (currentIdx >= 0 && currentIdx < videoState.library.clipGroups.length - 1) {
      const nextGroup = videoState.library.clipGroups[currentIdx + 1];
      setVideoState((prev) => ({
        ...prev,
        selectedGroupId: nextGroup.id,
        currentTime: 0,
        duration: 0,
      }));
    } else {
      setVideoState((prev) => ({ ...prev, isPlaying: false }));
    }
  }, [videoState.library, videoState.selectedGroupId]);

  const handleSeekRelative = useCallback(
    (delta: number) => {
      if (!videoPlayerRef.current) return;
      const newTime = videoState.currentTime + delta;
      const clamped = Math.max(0, Math.min(newTime, videoState.duration || 0));
      if (isFinite(clamped)) videoPlayerRef.current.seek(clamped);
    },
    [videoState.currentTime, videoState.duration]
  );

  const handleMuteToggle = useCallback(() => {
    videoPlayerRef.current?.toggleMute();
  }, []);

  const handleReset = useCallback(() => {
    setVideoState({
      library: null,
      selectedGroupId: '',
      playbackRate: 1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    });
    telemetryFramesRef.current = [];
    setHasTelemetry(false);
    setCurrentSei(null);
    setGpsPath([]);
    // Don't clear savedFolderName so "Reopen" button still works
  }, []);

  const hasVideos = videoState.library !== null && videoState.library.clipGroups.length > 0;
  const selectedGroup = hasVideos
    ? videoState.library!.clipGroupById.get(videoState.selectedGroupId) || null
    : null;

  useKeyboardShortcuts({
    isActive: hasVideos,
    isPlaying: videoState.isPlaying,
    playbackRate: videoState.playbackRate,
    duration: videoState.duration,
    onPlayPause: handlePlayPause,
    onSeek: handleSeek,
    onSeekRelative: handleSeekRelative,
    onPlaybackRateChange: handlePlaybackRateChange,
    onMuteToggle: handleMuteToggle,
  });

  return (
    <div
      className="h-screen flex overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-primary">
            <Upload className="h-12 w-12" />
            <p className="text-lg font-medium">Drop TeslaCam folder or files</p>
            <p className="text-sm text-muted-foreground">
              Supports RecentClips, SavedClips, and SentryClips
            </p>
          </div>
        </div>
      )}

      {/* Left: header + content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-50 flex-shrink-0 relative">
          <div className="px-4 h-12 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-shrink-0">
              <Shield className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-semibold tracking-tight">SentryCam</h1>
            </div>

            {/* Inline telemetry dashboard */}
            {hasVideos && hasTelemetry && (
              <div className="flex-1 flex justify-center min-w-0">
                <TelemetryDashboard sei={currentSei} visible={true} />
              </div>
            )}

            {hasVideos && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => setSidebarOpen((v) => !v)}
                  aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                >
                  {sidebarOpen ? (
                    <PanelRightClose className="h-4 w-4" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={handleReset}
                >
                  Change Files
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 min-h-0">
          {!hasVideos ? (
            /* Empty state / file picker */
            <div className="flex items-center justify-center h-full">
            <div className="max-w-lg w-full mx-auto px-4 space-y-8">
              {isLoading ? (
                /* Loading state */
                <div className="text-center space-y-4">
                  <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-card border border-border/50 mb-2 animate-pulse">
                    <Shield className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight">Loading clips...</h2>
                  {savedFolderName && (
                    <p className="text-sm text-muted-foreground">
                      Reading from <span className="font-mono text-foreground/70">{savedFolderName}/</span>
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="text-center space-y-3">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-card border border-border/50 mb-2">
                      <Shield className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h2 className="text-2xl font-semibold tracking-tight">SentryCam Viewer</h2>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      View dashcam and sentry mode footage with live telemetry. Drop a TeslaCam
                      folder or select files to get started.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <input
                      ref={directoryInputRef}
                      type="file"
                      webkitdirectory=""
                      directory=""
                      onChange={handleFileSelect}
                      className="hidden"
                      aria-label="Select TeslaCam directory"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".mp4"
                      onChange={handleFileSelect}
                      className="hidden"
                      aria-label="Select video files"
                    />

                    {/* Reopen last folder (if saved) */}
                    {savedFolderName && hasDirectoryPickerSupport() && (
                      <Button
                        onClick={handleReopenLast}
                        className="w-full h-12 justify-start gap-3 text-sm"
                      >
                        <RotateCcw className="h-4 w-4" />
                        <div className="text-left">
                          <div className="font-medium">
                            Reopen {savedFolderName}/
                          </div>
                          <div className="text-xs opacity-70">
                            Load the last folder you used
                          </div>
                        </div>
                      </Button>
                    )}

                    {/* Primary: File System Access API directory picker */}
                    {hasDirectoryPickerSupport() ? (
                      <Button
                        onClick={handlePickDirectory}
                        variant="outline"
                        className="w-full h-12 justify-start gap-3 text-sm"
                      >
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        <div className="text-left">
                          <div className="font-medium">Select TeslaCam Directory</div>
                          <div className="text-xs text-muted-foreground">
                            RecentClips, SavedClips, or SentryClips
                          </div>
                        </div>
                      </Button>
                    ) : (
                      <Button
                        onClick={() => directoryInputRef.current?.click()}
                        variant="outline"
                        className="w-full h-12 justify-start gap-3 text-sm"
                      >
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        <div className="text-left">
                          <div className="font-medium">Select TeslaCam Directory</div>
                          <div className="text-xs text-muted-foreground">
                            RecentClips, SavedClips, or SentryClips
                          </div>
                        </div>
                      </Button>
                    )}

                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="outline"
                      className="w-full h-12 justify-start gap-3 text-sm"
                    >
                      <FileVideo className="h-4 w-4 text-muted-foreground" />
                      <div className="text-left">
                        <div className="font-medium">Select Video Files</div>
                        <div className="text-xs text-muted-foreground">Choose individual .mp4 files</div>
                      </div>
                    </Button>

                  </div>

                  <div className="text-center space-y-2">
                    <p className="text-xs text-muted-foreground/60">
                      Or drag & drop your TeslaCam folder anywhere on this page
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 text-[10px] text-muted-foreground/40">
                      <span>Speed</span>
                      <span>•</span>
                      <span>Steering</span>
                      <span>•</span>
                      <span>GPS</span>
                      <span>•</span>
                      <span>Autopilot</span>
                      <span>•</span>
                      <span>G-Force</span>
                      <span>•</span>
                      <span>Compass</span>
                    </div>
                    <p className="text-xs text-muted-foreground/40">
                      Telemetry requires firmware 2025.44.25+ and HW3+
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          /* Player view */
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-0 p-3 relative">
              {/* Video grid */}
              <VideoPlayer
                ref={videoPlayerRef}
                group={selectedGroup}
                layoutId={layoutId}
                playbackRate={videoState.playbackRate}
                autoplay={autoplay}
                sei={currentSei}
                onTimeUpdate={handleTimeUpdate}
                onVideoEnd={handleVideoEnd}
              />

              {/* Mini map overlay (draggable, stays on video) */}
              {hasTelemetry && mapVisible && gpsPath.length > 0 && (
                <MiniMap ref={miniMapRef} gpsPath={gpsPath} visible={true} layoutId={layoutId} />
              )}
            </div>

            {/* Transport controls */}
            <div className="px-3 pb-3 flex-shrink-0">
              <VideoControls
                isPlaying={videoState.isPlaying}
                currentTime={videoState.currentTime}
                duration={videoState.duration}
                playbackRate={videoState.playbackRate}
                layoutId={layoutId}
                autoplay={autoplay}
                hasTelemetry={hasTelemetry}
                hasMap={gpsPath.length > 0}
                mapVisible={mapVisible}
                onPlayPause={handlePlayPause}
                onPlaybackRateChange={handlePlaybackRateChange}
                onSeek={handleSeek}
                onLayoutChange={setLayoutId}
                onAutoplayChange={setAutoplay}
                onMapToggle={() => setMapVisible((v) => !v)}
                onJumpToEvent={undefined}
                showJumpToEvent={false}
              />
            </div>
          </div>
        )}
        </main>
      </div>

      {/* Clips sidebar — full height, animated slide */}
      {hasVideos && (
        <div
          className="flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out border-l border-border/50"
          style={{ width: sidebarOpen ? 200 : 0 }}
        >
          <div className="w-[200px] h-full">
            <ClipBrowser
              library={videoState.library!}
              selectedGroupId={videoState.selectedGroupId}
              onGroupSelect={handleGroupSelect}
            />
          </div>
        </div>
      )}
    </div>
  );
}
