import { createStore } from "solid-js/store";
import { loadState, createPersistEffect } from "@/lib/persist";
import { doc } from "@/stores/project-store";

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
  /**
   * Where an edit from the source monitor lands.
   *
   * One target per kind, because an edit carries picture and sound and they go
   * to different places. Null means "the first of that kind", so a new project
   * works without anyone having to arm a track first.
   */
  targetVideoTrackId: string | null;
  targetAudioTrackId: string | null;
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
  targetVideoTrackId: null,
  targetAudioTrackId: null,
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
  const all: ClipRef[] = doc().tracks.flatMap((t) =>
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

// ── Track targeting ───────────────────────────────────────────────────

/**
 * The track an edit of this kind lands on.
 *
 * Falls back to the first track of the kind, and also falls back when the
 * armed track has since been deleted — a stale id would otherwise make every
 * edit silently do nothing.
 */
export function targetTrackId(kind: "video" | "audio"): string | null {
  const armed =
    kind === "video"
      ? timelineState.targetVideoTrackId
      : timelineState.targetAudioTrackId;

  const tracks = doc().tracks.filter((t) => t.kind === kind);
  if (armed && tracks.some((t) => t.id === armed)) return armed;
  return tracks[0]?.id ?? null;
}

export function setTargetTrack(kind: "video" | "audio", trackId: string | null): void {
  setTimelineState(
    kind === "video" ? "targetVideoTrackId" : "targetAudioTrackId",
    trackId,
  );
}

/** Whether a track is the one edits land on. */
export function isTargetTrack(trackId: string): boolean {
  const track = doc().tracks.find((t) => t.id === trackId);
  if (!track) return false;
  return targetTrackId(track.kind) === trackId;
}
