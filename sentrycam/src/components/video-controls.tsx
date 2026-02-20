'use client';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Pause, SkipForward, LayoutGrid, MapPin } from 'lucide-react';
import { GRID_LAYOUTS } from '@/types/video';

interface VideoControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  layoutId: string;
  autoplay: boolean;
  hasTelemetry: boolean;
  hasMap: boolean;
  mapVisible: boolean;
  onPlayPause: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onSeek: (time: number) => void;
  onLayoutChange: (layoutId: string) => void;
  onAutoplayChange: (enabled: boolean) => void;
  onMapToggle: () => void;
  onJumpToEvent?: () => void;
  showJumpToEvent: boolean;
}

const PLAYBACK_RATES = [0.5, 1, 3, 10];

const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const VideoControls = ({
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  layoutId,
  autoplay,
  hasTelemetry,
  hasMap,
  mapVisible,
  onPlayPause,
  onPlaybackRateChange,
  onSeek,
  onLayoutChange,
  onAutoplayChange,
  onMapToggle,
  onJumpToEvent,
  showJumpToEvent,
}: VideoControlsProps) => {
  const handleSeek = (value: number[]) => {
    if (!duration || !isFinite(duration)) return;
    const newTime = (value[0] / 100) * duration;
    if (!isFinite(newTime)) return;
    onSeek(newTime);
  };

  const seekValue = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-xl bg-card/60 backdrop-blur-sm border border-border/50 px-4 py-3 space-y-3">
      {/* Seek bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground w-10 text-right tabular-nums">
          {formatTime(currentTime)}
        </span>
        <Slider
          value={[seekValue]}
          onValueChange={handleSeek}
          max={100}
          step={0.1}
          className="flex-1"
          aria-label="Video seek bar"
        />
        <span className="text-xs font-mono text-muted-foreground w-10 tabular-nums">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Play/Pause */}
        <Button
          onClick={onPlayPause}
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        <div className="h-4 w-px bg-border/50 mx-1" />

        {/* Speed buttons */}
        <div className="flex gap-0.5">
          {PLAYBACK_RATES.map((rate) => (
            <Button
              key={rate}
              onClick={() => onPlaybackRateChange(rate)}
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs font-mono ${
                playbackRate === rate
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label={`Set playback speed to ${rate}x`}
            >
              {rate}x
            </Button>
          ))}
        </div>

        <div className="h-4 w-px bg-border/50 mx-1" />

        {/* Layout selector */}
        <div className="flex items-center gap-1.5">
          <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={layoutId} onValueChange={onLayoutChange}>
            <SelectTrigger className="h-7 w-[180px] text-xs bg-transparent border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-none">
              {Object.entries(GRID_LAYOUTS).map(([id, layout]) => (
                <SelectItem key={id} value={id} className="text-xs">
                  {layout.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="h-4 w-px bg-border/50 mx-1" />

        {/* Autoplay toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(e) => onAutoplayChange(e.target.checked)}
            className="rounded border-border/50 h-3.5 w-3.5 accent-primary"
          />
          Autoplay
        </label>

        {/* Map toggle */}
        {hasMap && (
          <>
            <div className="h-4 w-px bg-border/50 mx-1" />
            <Button
              onClick={onMapToggle}
              variant={mapVisible ? 'default' : 'ghost'}
              size="sm"
              className={`h-7 text-xs gap-1 ${
                mapVisible
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="Toggle map"
            >
              <MapPin className="h-3 w-3" />
              Map
            </Button>
          </>
        )}

        {showJumpToEvent && onJumpToEvent && (
          <>
            <div className="h-4 w-px bg-border/50 mx-1" />
            <Button
              onClick={onJumpToEvent}
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
            >
              <SkipForward className="h-3 w-3" />
              Jump to Event
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
