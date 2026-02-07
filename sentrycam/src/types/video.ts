// Camera suffixes for filename parsing
export const CAMERA_SUFFIXES: Record<string, string> = {
  '-left_repeater': 'left_repeater',
  '-front': 'front',
  '-right_repeater': 'right_repeater',
  '-rear_view': 'rear_view',
  '-back': 'back',
  '-left_pillar': 'left_pillar',
  '-right_pillar': 'right_pillar',
};

export type CameraKey =
  | 'front'
  | 'back'
  | 'left_repeater'
  | 'right_repeater'
  | 'left_pillar'
  | 'right_pillar'
  | 'rear_view';

export type FolderTag = 'RecentClips' | 'SavedClips' | 'SentryClips' | 'unknown';

export interface ClipGroup {
  id: string;
  tag: FolderTag;
  eventId: string | null;
  timestampKey: string;
  filesByCamera: Map<CameraKey, File>;
  eventMeta: SentryEventMeta | null;
}

export interface SentryEventMeta {
  timestamp: string;
  reason: string;
  camera: string;
  city: string;
  street: string;
  est_lat: number;
  est_lon: number;
  [key: string]: unknown;
}

export interface ClipLibrary {
  clipGroups: ClipGroup[];
  clipGroupById: Map<string, ClipGroup>;
  folderLabel: string | null;
}

export interface VideoState {
  library: ClipLibrary | null;
  selectedGroupId: string;
  playbackRate: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

// Layout presets for multi-camera grid
export interface CameraSlot {
  camera: CameraKey;
  label: string;
}

export interface GridLayout {
  name: string;
  columns: number;
  immersive?: boolean;
  slots: CameraSlot[];
}

export const GRID_LAYOUTS: Record<string, GridLayout> = {
  immersive: {
    name: 'Immersive (Theater)',
    columns: 1,
    immersive: true,
    slots: [
      { camera: 'front', label: 'Front' },
      { camera: 'left_pillar', label: 'Left Pillar' },
      { camera: 'right_pillar', label: 'Right Pillar' },
      { camera: 'left_repeater', label: 'Left Repeater' },
      { camera: 'back', label: 'Back' },
      { camera: 'right_repeater', label: 'Right Repeater' },
    ],
  },
  six_default: {
    name: 'Pillars Top / Repeaters Bottom',
    columns: 3,
    slots: [
      { camera: 'left_pillar', label: 'Left Pillar' },
      { camera: 'front', label: 'Front' },
      { camera: 'right_pillar', label: 'Right Pillar' },
      { camera: 'left_repeater', label: 'Left Repeater' },
      { camera: 'back', label: 'Back' },
      { camera: 'right_repeater', label: 'Right Repeater' },
    ],
  },
  six_repeaters_top: {
    name: 'Repeaters Top / Pillars Bottom',
    columns: 3,
    slots: [
      { camera: 'left_repeater', label: 'Left Repeater' },
      { camera: 'front', label: 'Front' },
      { camera: 'right_repeater', label: 'Right Repeater' },
      { camera: 'left_pillar', label: 'Left Pillar' },
      { camera: 'back', label: 'Back' },
      { camera: 'right_pillar', label: 'Right Pillar' },
    ],
  },
  four_cam: {
    name: '4-cam: Front/Back/L/R',
    columns: 2,
    slots: [
      { camera: 'front', label: 'Front' },
      { camera: 'back', label: 'Back' },
      { camera: 'left_repeater', label: 'Left Repeater' },
      { camera: 'right_repeater', label: 'Right Repeater' },
    ],
  },
  three_cam: {
    name: '3-cam: L/Front/R',
    columns: 3,
    slots: [
      { camera: 'left_repeater', label: 'Left Repeater' },
      { camera: 'front', label: 'Front' },
      { camera: 'right_repeater', label: 'Right Repeater' },
    ],
  },
};

export const DEFAULT_LAYOUT = 'four_cam';

export const displayTimestamp = (timestamp: string, showSeconds = false): string => {
  const parts = timestamp.split('_');
  if (parts.length > 1) {
    const dateArray = parts[0].split('-');
    const timeArray = parts[1].split('-');
    let formatted = `${dateArray[0]}-${dateArray[1]}-${dateArray[2]} ${timeArray[0]}:${timeArray[1]}`;
    if (showSeconds && timeArray[2] !== undefined) {
      formatted = `${formatted}:${timeArray[2]}`;
    }
    return formatted;
  }
  return timestamp;
};
