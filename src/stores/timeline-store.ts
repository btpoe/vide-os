import { createStore } from "solid-js/store";
import { loadState, createPersistEffect } from "@/lib/persist";
import { projectState } from "@/stores/project-store";

const TIMELINE_KEY = "timeline";

interface PersistedTimelineState {
  snapEnabled: boolean;
}

export interface ClipRef {
  trackId: string;
  clipId: string;
}

export interface TimelineState {
  selectedClips: ClipRef[];
  hoveredClip: ClipRef | null;
  dragging: boolean;
  dragStartX: number;
  dragStartTime: number;
  trimming: "left" | "right" | null;
  trimClip: ClipRef | null;
  snapEnabled: boolean;
  trackDragId: string | null;
  trackDropIndex: number | null;
}

function loadTimelinePrefs(): Partial<TimelineState> {
  const saved = loadState<PersistedTimelineState>(TIMELINE_KEY);
  return saved ? { snapEnabled: saved.snapEnabled ?? true } : {};
}

const [timelineState, setTimelineState] = createStore<TimelineState>({
  selectedClips: [],
  hoveredClip: null,
  dragging: false,
  dragStartX: 0,
  dragStartTime: 0,
  trimming: null,
  trimClip: null,
  snapEnabled: true,
  trackDragId: null,
  trackDropIndex: null,
  ...loadTimelinePrefs(),
});

/** Call once inside a reactive root to enable auto-save of timeline prefs. */
export function initTimelinePersistence(): void {
  createPersistEffect(TIMELINE_KEY, (): PersistedTimelineState => ({
    snapEnabled: timelineState.snapEnabled,
  }));
}

// ── Selection ────────────────────────────────────────────────────────

export function selectClip(ref: ClipRef, additive: boolean = false): void {
  if (additive) {
    const exists = timelineState.selectedClips.find(
      (c) => c.clipId === ref.clipId && c.trackId === ref.trackId,
    );
    if (exists) {
      // Deselect
      setTimelineState(
        "selectedClips",
        timelineState.selectedClips.filter(
          (c) => !(c.clipId === ref.clipId && c.trackId === ref.trackId),
        ),
      );
    } else {
      setTimelineState("selectedClips", [...timelineState.selectedClips, ref]);
    }
  } else {
    setTimelineState("selectedClips", [ref]);
  }
}

export function clearSelection(): void {
  setTimelineState("selectedClips", []);
}

export function isClipSelected(trackId: string, clipId: string): boolean {
  return timelineState.selectedClips.some(
    (c) => c.clipId === clipId && c.trackId === trackId,
  );
}

export function selectAllClips(): void {
  const all: ClipRef[] = projectState.tracks.flatMap((t) =>
    t.clips.map((c) => ({ trackId: t.id, clipId: c.id })),
  );
  setTimelineState("selectedClips", all);
}

// ── Drag state ───────────────────────────────────────────────────────

export function startDrag(x: number, startTime: number): void {
  setTimelineState({ dragging: true, dragStartX: x, dragStartTime: startTime });
}

export function endDrag(): void {
  setTimelineState({ dragging: false, dragStartX: 0, dragStartTime: 0 });
}

// ── Trim state ───────────────────────────────────────────────────────

export function startTrim(side: "left" | "right", ref: ClipRef): void {
  setTimelineState({ trimming: side, trimClip: ref });
}

export function endTrim(): void {
  setTimelineState({ trimming: null, trimClip: null });
}

// ── Track reorder drag ────────────────────────────────────────────────

export function startTrackDrag(trackId: string): void {
  setTimelineState({ trackDragId: trackId, trackDropIndex: null });
}

export function updateTrackDropIndex(index: number | null): void {
  setTimelineState("trackDropIndex", index);
}

export function endTrackDrag(): void {
  setTimelineState({ trackDragId: null, trackDropIndex: null });
}

// ── Snap ─────────────────────────────────────────────────────────────

export function toggleSnap(): void {
  setTimelineState("snapEnabled", !timelineState.snapEnabled);
}

export { timelineState, setTimelineState };
