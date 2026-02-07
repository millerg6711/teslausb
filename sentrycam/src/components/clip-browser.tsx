'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import type { ClipGroup, ClipLibrary, FolderTag, SentryEventMeta } from '@/types/video';
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
} from 'lucide-react';

interface ClipBrowserProps {
  library: ClipLibrary;
  selectedGroupId: string;
  onGroupSelect: (groupId: string) => void;
}

// --- Helpers ---

const TAG_CONFIG: Record<FolderTag, { icon: typeof Shield; color: string; label: string }> = {
  SentryClips: { icon: Shield, color: 'text-red-400', label: 'Sentry' },
  SavedClips: { icon: Bookmark, color: 'text-blue-400', label: 'Saved' },
  RecentClips: { icon: History, color: 'text-emerald-400', label: 'Recent' },
  unknown: { icon: FolderOpen, color: 'text-neutral-400', label: 'Other' },
};

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

// --- Main Component (fixed sidebar) ---

export const ClipBrowser = ({
  library, selectedGroupId, onGroupSelect,
}: ClipBrowserProps) => {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedGroupId]);

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

  if (!library || library.clipGroups.length === 0) return null;

  const totalClips = library.clipGroups.length;

  return (
    <div className="h-full flex flex-col bg-card/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50 flex-shrink-0">
        <Camera className="h-3.5 w-3.5 text-white/30" />
        <span className="text-[11px] font-semibold text-white/70 tracking-tight">Clips</span>
        <span className="text-[9px] text-white/25 tabular-nums">{totalClips}</span>
      </div>

      {/* Clip list */}
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
    </div>
  );
};
