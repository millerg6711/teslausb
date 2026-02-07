'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { ClipGroup, ClipLibrary, FolderTag, SentryEventMeta, CameraKey } from '@/types/video';
import {
  Shield,
  Camera,
  Clock,
  MapPin,
  ChevronDown,
  ChevronRight,
  Bookmark,
  History,
  FolderOpen,
  Minus,
  Maximize2,
} from 'lucide-react';

interface ClipBrowserProps {
  library: ClipLibrary;
  selectedGroupId: string;
  visible: boolean;
  onGroupSelect: (groupId: string) => void;
}

// --- Drag persistence ---

const STORAGE_KEY = 'sentrycam-clips-pos';
const SIZE_KEY = 'sentrycam-clips-size';
const COLLAPSED_KEY = 'sentrycam-clips-collapsed';

const loadPosition = (): { x: number; y: number } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos.x === 'number' && typeof pos.y === 'number') return pos;
  } catch {}
  return null;
};

const savePosition = (x: number, y: number) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y })); } catch {}
};

const loadCollapsed = (): boolean => {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
};

const saveCollapsed = (v: boolean) => {
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch {}
};

// --- Helpers ---

const TAG_CONFIG: Record<FolderTag, { icon: typeof Shield; color: string; label: string }> = {
  SentryClips: { icon: Shield, color: 'text-red-400', label: 'Sentry' },
  SavedClips: { icon: Bookmark, color: 'text-blue-400', label: 'Saved' },
  RecentClips: { icon: History, color: 'text-emerald-400', label: 'Recent' },
  unknown: { icon: FolderOpen, color: 'text-neutral-400', label: 'Other' },
};

const CAMERA_ICONS: Record<CameraKey, string> = {
  front: 'F',
  back: 'B',
  left_repeater: 'L',
  right_repeater: 'R',
  left_pillar: 'LP',
  right_pillar: 'RP',
  rear_view: 'B',
};

const CAMERA_ORDER: CameraKey[] = [
  'left_pillar', 'left_repeater', 'front', 'right_repeater', 'right_pillar', 'back', 'rear_view',
];

const formatClipTime = (timestampKey: string): { date: string; time: string } => {
  const parts = timestampKey.split('_');
  if (parts.length < 2) return { date: timestampKey, time: '' };
  const [year, month, day] = parts[0].split('-');
  const timeParts = parts[1].split('-');
  const hours = parseInt(timeParts[0], 10);
  const minutes = timeParts[1];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return { date: `${month}/${day}/${year}`, time: `${h12}:${minutes} ${ampm}` };
};

// --- Sub-components ---

const CameraDots = ({ cameras }: { cameras: CameraKey[] }) => {
  const sorted = CAMERA_ORDER.filter((cam) => cameras.includes(cam));
  return (
    <div className="flex gap-px">
      {sorted.map((cam) => (
        <span
          key={cam}
          className="text-[7px] font-bold leading-none bg-white/8 text-white/40 rounded-sm px-0.5 py-px"
          title={cam.replace(/_/g, ' ')}
        >
          {CAMERA_ICONS[cam]}
        </span>
      ))}
    </div>
  );
};

const EventInfo = ({ meta }: { meta: SentryEventMeta }) => (
  <div className="mt-1 text-[9px] text-white/40 space-y-0.5">
    {meta.reason && (
      <div className="flex items-center gap-1">
        <Shield className="h-2 w-2 text-red-400/50 flex-shrink-0" />
        <span className="truncate">{meta.reason}</span>
      </div>
    )}
    {meta.city && (
      <div className="flex items-center gap-1">
        <MapPin className="h-2 w-2 flex-shrink-0" />
        <span className="truncate">
          {meta.city}{meta.street ? `, ${meta.street}` : ''}
        </span>
      </div>
    )}
  </div>
);

interface FolderSectionProps {
  tag: FolderTag;
  groups: ClipGroup[];
  selectedGroupId: string;
  onGroupSelect: (groupId: string) => void;
  activeRef: React.RefObject<HTMLDivElement | null>;
  defaultOpen: boolean;
}

const FolderSection = ({
  tag, groups, selectedGroupId, onGroupSelect, activeRef, defaultOpen,
}: FolderSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const config = TAG_CONFIG[tag];
  const Icon = config.icon;

  return (
    <div>
      <button
        onClick={() => setIsOpen((p) => !p)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-white/5 transition-colors"
        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${config.label}`}
      >
        {isOpen ? (
          <ChevronDown className="h-2.5 w-2.5 text-white/25" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 text-white/25" />
        )}
        <Icon className={`h-3 w-3 ${config.color}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
          {config.label}
        </span>
        <span className="text-[9px] text-white/20 ml-auto tabular-nums">
          {groups.length}
        </span>
      </button>

      {isOpen && (
        <div className="pb-0.5">
          {groups.map((group, idx) => {
            const isSelected = group.id === selectedGroupId;
            const { date, time } = formatClipTime(group.timestampKey);
            const cameras = Array.from(group.filesByCamera.keys());
            const showDate =
              idx === 0 || formatClipTime(groups[idx - 1].timestampKey).date !== date;

            return (
              <div key={group.id}>
                {showDate && (
                  <div className="px-2.5 pt-2 pb-0.5">
                    <span className="text-[8px] font-semibold text-white/15 uppercase tracking-widest">
                      {date}
                    </span>
                  </div>
                )}
                <div
                  ref={isSelected ? activeRef : null}
                  onClick={() => onGroupSelect(group.id)}
                  className={`cursor-pointer mx-1 px-2 py-1.5 rounded-md transition-all ${
                    isSelected
                      ? 'bg-white/10 ring-1 ring-white/20'
                      : 'hover:bg-white/5'
                  }`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Play clip from ${time} on ${date}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onGroupSelect(group.id);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Clock
                        className={`h-2.5 w-2.5 flex-shrink-0 ${
                          isSelected ? 'text-sky-400' : 'text-white/20'
                        }`}
                      />
                      <span
                        className={`text-xs font-medium tabular-nums ${
                          isSelected ? 'text-white' : 'text-white/60'
                        }`}
                      >
                        {time}
                      </span>
                    </div>
                    <CameraDots cameras={cameras} />
                  </div>
                  {group.eventMeta && <EventInfo meta={group.eventMeta} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// --- Main Component ---

export const ClipBrowser = ({
  library, selectedGroupId, visible, onGroupSelect,
}: ClipBrowserProps) => {
  const activeRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const rafId = useRef(0);

  useEffect(() => {
    const saved = loadPosition();
    if (saved) setPos(saved);
    setCollapsed(loadCollapsed());
  }, []);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedGroupId]);

  // Window-level drag
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !wrapperRef.current) return;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const el = wrapperRef.current;
        if (!el) return;
        const parent = el.parentElement;
        if (!parent) return;
        const parentRect = parent.getBoundingClientRect();
        const elW = el.offsetWidth;
        const elH = el.offsetHeight;
        let x = e.clientX - parentRect.left - offset.current.x;
        let y = e.clientY - parentRect.top - offset.current.y;
        x = Math.max(0, Math.min(x, parentRect.width - elW));
        y = Math.max(0, Math.min(y, parentRect.height - elH));
        setPos({ x, y });
      });
    };

    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      cancelAnimationFrame(rafId.current);
      setPos((current) => {
        if (current) savePosition(current.x, current.y);
        return current;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(rafId.current);
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      saveCollapsed(!v);
      return !v;
    });
  }, []);

  const groupedByTag = useMemo(() => {
    const map = new Map<FolderTag, ClipGroup[]>();
    for (const group of library.clipGroups) {
      const list = map.get(group.tag) || [];
      list.push(group);
      map.set(group.tag, list);
    }
    const order: FolderTag[] = ['SentryClips', 'SavedClips', 'RecentClips', 'unknown'];
    return order
      .filter((tag) => map.has(tag))
      .map((tag) => ({ tag, groups: map.get(tag)! }));
  }, [library.clipGroups]);

  if (!visible || !library || library.clipGroups.length === 0) return null;

  const totalClips = library.clipGroups.length;

  const style: React.CSSProperties = pos
    ? { position: 'absolute', left: pos.x, top: pos.y }
    : { position: 'absolute', top: 8, right: 8 };

  return (
    <div ref={wrapperRef} className="z-30 select-none" style={style}>
      <div className="rounded-lg bg-black/70 backdrop-blur-xl border border-white/[0.06] shadow-2xl overflow-hidden flex flex-col"
        style={{ width: 260, maxHeight: collapsed ? 'auto' : 'min(480px, calc(100vh - 200px))' }}
      >
        {/* Drag header */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing border-b border-white/[0.06] flex-shrink-0"
          onPointerDown={handlePointerDown}
        >
          <div className="flex items-center gap-2 pointer-events-none">
            <Camera className="h-3.5 w-3.5 text-white/30" />
            <span className="text-[11px] font-semibold text-white/70 tracking-tight">Clips</span>
            <span className="text-[9px] text-white/25 tabular-nums">{totalClips}</span>
          </div>
          <button
            onClick={handleToggleCollapse}
            className="pointer-events-auto p-0.5 rounded hover:bg-white/10 transition-colors"
            aria-label={collapsed ? 'Expand clips' : 'Collapse clips'}
          >
            {collapsed ? (
              <Maximize2 className="h-3 w-3 text-white/30" />
            ) : (
              <Minus className="h-3 w-3 text-white/30" />
            )}
          </button>
        </div>

        {/* Clip list */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
            <div className="py-0.5">
              {groupedByTag.map(({ tag, groups }, idx) => (
                <FolderSection
                  key={tag}
                  tag={tag}
                  groups={groups}
                  selectedGroupId={selectedGroupId}
                  onGroupSelect={onGroupSelect}
                  activeRef={activeRef}
                  defaultOpen={idx === 0 || groups.some((g) => g.id === selectedGroupId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
