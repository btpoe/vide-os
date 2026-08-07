/**
 * What part of the timeline is on screen, and at what scale.
 *
 * Pure view state — nothing here is part of the document and nothing here is
 * undoable. Zoom and scroll persist across sessions because losing your place
 * on reload is annoying; the viewport width does not, because it comes from
 * the DOM.
 *
 * All the arithmetic lives in `lib/timeline-geometry.ts`. This module holds the
 * state and the reactive glue.
 */

import { createSignal, createMemo } from "solid-js";
import {
  type TimelineView,
  clampScroll,
  centerOnFrame,
  fitToWindow,
  maxScrollLeftPx,
  pxPerFrameFromPxPerSecond,
  pxPerSecond as viewPxPerSecond,
  scrollToFrame,
  zoomAt,
  zoomCentered,
  zoomToRange,
} from "@/lib/timeline-geometry";
import { contentEndFrame } from "@/model/doc";
import { doc, sequenceFrameRate, playheadFrame } from "@/stores/project-store";
import { loadState, saveState } from "@/lib/persist";

const VIEW_KEY = "timeline-view";

interface PersistedView {
  pxPerSecond: number;
  scrollLeftPx: number;
  trackHeights: Record<string, number>;
}

/** A comfortable starting scale: about a minute across a 1000px panel. */
const DEFAULT_PX_PER_SECOND = 16;

function loadPersisted(): PersistedView {
  const saved = loadState<PersistedView>(VIEW_KEY);
  return {
    pxPerSecond: saved?.pxPerSecond ?? DEFAULT_PX_PER_SECOND,
    scrollLeftPx: saved?.scrollLeftPx ?? 0,
    trackHeights: saved?.trackHeights ?? {},
  };
}

const persisted = loadPersisted();

// Stored as pixels-per-second because that is the user-facing notion of zoom
// and it survives a change of project frame rate. The geometry works in
// pixels-per-frame, derived below.
const [pxPerSecondSignal, setPxPerSecondSignal] = createSignal(persisted.pxPerSecond);
const [scrollLeftPx, setScrollLeftSignal] = createSignal(persisted.scrollLeftPx);
const [viewportWidthPx, setViewportWidthPx] = createSignal(1000);
const [trackHeights, setTrackHeights] = createSignal<Record<string, number>>(
  persisted.trackHeights,
);

export { scrollLeftPx, viewportWidthPx };

export const pxPerSecond = pxPerSecondSignal;

/** The view the geometry functions take. */
export const timelineView = createMemo<TimelineView>(() => ({
  pxPerFrame: pxPerFrameFromPxPerSecond(pxPerSecondSignal(), sequenceFrameRate()),
  scrollLeftPx: scrollLeftPx(),
  viewportWidthPx: viewportWidthPx(),
}));

/** Last frame occupied by any clip. Drives scroll extent, not a stored duration. */
export const timelineEndFrame = createMemo(() => contentEndFrame(doc()));

function apply(next: TimelineView): void {
  setPxPerSecondSignal(viewPxPerSecond(next, sequenceFrameRate()));
  setScrollLeftSignal(next.scrollLeftPx);
  persist();
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const snapshot: PersistedView = {
      pxPerSecond: pxPerSecondSignal(),
      scrollLeftPx: scrollLeftPx(),
      trackHeights: trackHeights(),
    };
    saveState(VIEW_KEY, snapshot);
  }, 400);
}

// ── Viewport ──────────────────────────────────────────────────────────

export function setViewportWidth(width: number): void {
  if (width <= 0 || width === viewportWidthPx()) return;
  setViewportWidthPx(width);
  // A narrower panel can leave the scroll offset past the end.
  setScrollLeftSignal(clampScroll(timelineView(), timelineEndFrame()).scrollLeftPx);
}

// ── Scrolling ─────────────────────────────────────────────────────────

export function setScrollLeft(px: number): void {
  const clamped = Math.max(
    0,
    Math.min(px, maxScrollLeftPx(timelineView(), timelineEndFrame())),
  );
  if (clamped === scrollLeftPx()) return;
  setScrollLeftSignal(clamped);
  persist();
}

export function scrollBy(deltaPx: number): void {
  setScrollLeft(scrollLeftPx() + deltaPx);
}

/** Brings a frame into view with a margin, doing nothing if already visible. */
export function revealFrame(frame: number): void {
  apply(scrollToFrame(timelineView(), frame, timelineEndFrame()));
}

export function centerFrame(frame: number): void {
  apply(centerOnFrame(timelineView(), frame, timelineEndFrame()));
}

// ── Zoom ──────────────────────────────────────────────────────────────

/** Multiplier per zoom step. Geometric, so repeated steps feel even. */
export const ZOOM_STEP = 1.25;

/** Zooms about a point in the scrolling strip — wheel and pinch. */
export function zoomAtX(anchorX: number, factor: number): void {
  apply(
    zoomAt(timelineView(), anchorX, factor, sequenceFrameRate(), timelineEndFrame()),
  );
}

export function zoomIn(): void {
  apply(
    zoomCentered(timelineView(), ZOOM_STEP, sequenceFrameRate(), timelineEndFrame()),
  );
}

export function zoomOut(): void {
  apply(
    zoomCentered(
      timelineView(),
      1 / ZOOM_STEP,
      sequenceFrameRate(),
      timelineEndFrame(),
    ),
  );
}

/** Fits the whole edit in the panel. The default view when nothing is selected. */
export function zoomToFit(): void {
  apply(fitToWindow(timelineView(), timelineEndFrame(), sequenceFrameRate()));
}

export function zoomToFrameRange(startFrame: number, endFrame: number): void {
  apply(zoomToRange(timelineView(), startFrame, endFrame, sequenceFrameRate()));
}

/** Zooms so a single frame is comfortably wide, centred on the playhead. */
export function zoomToFrameLevel(): void {
  const rate = sequenceFrameRate();
  const view = timelineView();
  apply(
    centerOnFrame(
      { ...view, pxPerFrame: pxPerFrameFromPxPerSecond(300, rate) },
      playheadFrame(),
      timelineEndFrame(),
    ),
  );
}

// ── Track heights ─────────────────────────────────────────────────────

export const MIN_TRACK_HEIGHT = 28;
export const MAX_TRACK_HEIGHT = 240;

export function trackHeight(trackId: string, fallback: number): number {
  return trackHeights()[trackId] ?? fallback;
}

export function setTrackHeight(trackId: string, heightPx: number): void {
  const clamped = Math.max(
    MIN_TRACK_HEIGHT,
    Math.min(MAX_TRACK_HEIGHT, Math.round(heightPx)),
  );
  setTrackHeights((prev) => ({ ...prev, [trackId]: clamped }));
  persist();
}

export function resetTrackHeights(): void {
  setTrackHeights({});
  persist();
}
