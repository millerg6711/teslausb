import {
  CAMERA_SUFFIXES,
  type CameraKey,
  type FolderTag,
  type ClipGroup,
  type ClipLibrary,
  type SentryEventMeta,
} from '@/types/video';

/** Parse a TeslaCam filename into timestampKey + camera.
 *  Filenames follow pattern: YYYY-MM-DD_HH-MM-SS-<camera>.mp4
 */
export const parseClipFilename = (
  name: string
): { timestampKey: string; camera: CameraKey } | null => {
  if (!name.endsWith('.mp4')) return null;

  const withoutExt = name.replace('.mp4', '');

  for (const [suffix, cameraKey] of Object.entries(CAMERA_SUFFIXES)) {
    if (withoutExt.endsWith(suffix)) {
      const timestampKey = withoutExt.slice(0, withoutExt.length - suffix.length);
      return { timestampKey, camera: cameraKey as CameraKey };
    }
  }
  return null;
};

/** Derive folder tag and eventId from a relative path */
const parseTeslaCamPath = (
  relPath: string
): { tag: FolderTag; eventId: string | null; segments: string[] } => {
  const segments = relPath.split('/').filter(Boolean);
  let tag: FolderTag = 'unknown';
  let eventId: string | null = null;

  for (const seg of segments) {
    if (seg === 'RecentClips') tag = 'RecentClips';
    else if (seg === 'SavedClips') tag = 'SavedClips';
    else if (seg === 'SentryClips') tag = 'SentryClips';
  }

  // For Sentry, the event folder is the directory right after SentryClips
  if (tag === 'SentryClips') {
    const sentryIdx = segments.indexOf('SentryClips');
    if (sentryIdx >= 0 && sentryIdx + 1 < segments.length - 1) {
      eventId = segments[sentryIdx + 1];
    }
  }

  return { tag, eventId, segments };
};

/** Build a clip library from a list of files */
export const buildClipLibrary = async (files: File[]): Promise<ClipLibrary> => {
  const groupMap = new Map<string, ClipGroup>();
  const eventJsonFiles = new Map<string, File>();

  for (const file of files) {
    const relPath =
      (file as any).webkitRelativePath || (file as any)._teslaPath || file.name;

    // Collect event.json files
    if (file.name === 'event.json') {
      const { tag, eventId } = parseTeslaCamPath(relPath);
      if (eventId) {
        eventJsonFiles.set(`${tag}/${eventId}`, file);
      }
      continue;
    }

    const parsed = parseClipFilename(file.name);
    if (!parsed) continue;

    const { tag, eventId } = parseTeslaCamPath(relPath);
    const groupId = eventId
      ? `${tag}/${eventId}/${parsed.timestampKey}`
      : `${tag}/${parsed.timestampKey}`;

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        id: groupId,
        tag,
        eventId,
        timestampKey: parsed.timestampKey,
        filesByCamera: new Map(),
        eventMeta: null,
      });
    }

    groupMap.get(groupId)!.filesByCamera.set(parsed.camera, file);
  }

  // Parse event.json files and attach to groups
  for (const [key, jsonFile] of eventJsonFiles) {
    try {
      const text = await jsonFile.text();
      const meta = JSON.parse(text) as SentryEventMeta;
      // Attach to all groups with matching tag/eventId
      for (const group of groupMap.values()) {
        const groupKey = group.eventId
          ? `${group.tag}/${group.eventId}`
          : null;
        if (groupKey === key) {
          group.eventMeta = meta;
        }
      }
    } catch {
      // Ignore malformed event.json
    }
  }

  const clipGroups = Array.from(groupMap.values()).sort((a, b) =>
    b.timestampKey.localeCompare(a.timestampKey)
  );

  const clipGroupById = new Map(clipGroups.map((g) => [g.id, g]));

  return {
    clipGroups,
    clipGroupById,
    folderLabel: null,
  };
};

/** Get the best layout based on available cameras */
export const detectBestLayout = (group: ClipGroup): string => {
  const cameras = Array.from(group.filesByCamera.keys());
  const hasPillar = cameras.some(
    (c) => c === 'left_pillar' || c === 'right_pillar'
  );
  const hasBack = cameras.some((c) => c === 'back' || c === 'rear_view');

  if (hasPillar) return 'six_default';
  if (hasBack && cameras.length >= 4) return 'four_cam';
  if (cameras.length >= 3) return 'three_cam';
  return 'four_cam';
};

/** Get video files for a group */
export const getVideoFilesForGroup = (
  group: ClipGroup
): Map<CameraKey, string> => {
  const urls = new Map<CameraKey, string>();
  for (const [camera, file] of group.filesByCamera) {
    urls.set(camera, URL.createObjectURL(file));
  }
  return urls;
};
