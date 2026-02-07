import { useEffect, useCallback } from 'react';

const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 3, 5, 10];

interface UseKeyboardShortcutsOptions {
  isActive: boolean;
  isPlaying: boolean;
  playbackRate: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onSeekRelative: (delta: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onMuteToggle: () => void;
}

export const useKeyboardShortcuts = ({
  isActive,
  isPlaying,
  playbackRate,
  duration,
  onPlayPause,
  onSeek,
  onSeekRelative,
  onPlaybackRateChange,
  onMuteToggle,
}: UseKeyboardShortcutsOptions) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive) return;

      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        // Play/Pause: Space or K
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          onPlayPause();
          break;

        // Rewind 10s: J
        case 'j':
        case 'J':
          e.preventDefault();
          onSeekRelative(-10);
          break;

        // Forward 10s: L
        case 'l':
        case 'L':
          e.preventDefault();
          onSeekRelative(10);
          break;

        // Rewind 5s: Left arrow
        case 'ArrowLeft':
          e.preventDefault();
          onSeekRelative(-5);
          break;

        // Forward 5s: Right arrow
        case 'ArrowRight':
          e.preventDefault();
          onSeekRelative(5);
          break;

        // Decrease speed: < (Shift + ,)
        case '<':
          e.preventDefault();
          {
            const currentIdx = PLAYBACK_RATES.indexOf(playbackRate);
            const nearestIdx =
              currentIdx === -1
                ? PLAYBACK_RATES.findIndex((r) => r >= playbackRate) - 1
                : currentIdx - 1;
            if (nearestIdx >= 0) {
              onPlaybackRateChange(PLAYBACK_RATES[nearestIdx]);
            }
          }
          break;

        // Increase speed: > (Shift + .)
        case '>':
          e.preventDefault();
          {
            const currentIdx = PLAYBACK_RATES.indexOf(playbackRate);
            const nearestIdx =
              currentIdx === -1
                ? PLAYBACK_RATES.findIndex((r) => r > playbackRate)
                : currentIdx + 1;
            if (nearestIdx >= 0 && nearestIdx < PLAYBACK_RATES.length) {
              onPlaybackRateChange(PLAYBACK_RATES[nearestIdx]);
            }
          }
          break;

        // Mute: M
        case 'm':
        case 'M':
          e.preventDefault();
          onMuteToggle();
          break;

        // Number keys 0-9: jump to 0%-90%
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          if (!e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            const pct = parseInt(e.key) / 10;
            if (isFinite(duration) && duration > 0) {
              onSeek(duration * pct);
            }
          }
          break;

        default:
          break;
      }
    },
    [isActive, playbackRate, duration, onPlayPause, onSeek, onSeekRelative, onPlaybackRateChange, onMuteToggle]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};
