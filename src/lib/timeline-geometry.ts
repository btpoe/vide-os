/**
 * Timeline coordinate mapping.
 *
 * The timeline is a horizontally scrolled strip. One number, `pxPerFrame`,
 * sets the scale; one number, `scrollLeftPx`, sets what part of it you are
 * looking at. Every position on screen derives from those two and an integer
 * frame number.
 *
 * This replaces geometry expressed as a percentage of total project duration,
 * where a clip's left edge was `startTime / projectDuration * 100%`. That has
 * no zoom — the whole project always fills the panel — so a twenty-second edit
 * inside a three-hundred-second project occupied six percent of the width with
 * no way to look closer. It also meant every clip's position depended on the
 * project's length, so adding a clip at the end moved every other clip on
 * screen.
 *
 * Pure: no stores, no DOM. Everything takes a view and returns a value or a
 * new view.
 */

import type { FrameRate } from "./timecode";
import { frameRateToNumber } from "./timecode";

/** What part of the timeline is on screen, and at what scale. */
export interface TimelineView {
  /**
   * Horizontal scale. Frames rather than seconds because the document counts
   * in frames, and a frame is the smallest position a clip edge can take.
   */
  pxPerFrame: number;
  /** Scroll offset in pixels from frame zero. */
  scrollLeftPx: number;
  /** Width of the visible strip, excluding the track headers. */
  viewportWidthPx: number;
}

/**
 * Zoom limits, in pixels per second so they mean the same thing at any frame
 * rate. The floor shows about four and a half hours in a 1000px viewport; the
 * ceiling gives roughly twenty pixels per frame at 30fps, enough to place a cut
 * on an exact frame.
 */
export const MIN_PX_PER_SECOND = 0.5;
export const MAX_PX_PER_SECOND = 600;

/** Blank space kept after the last clip so the end is reachable and draggable. */
export const TAIL_PAD_PX = 240;

export function pxPerSecond(view: TimelineView, rate: FrameRate): number {
  return view.pxPerFrame * frameRateToNumber(rate);
}

export function pxPerFrameFromPxPerSecond(value: number, rate: FrameRate): number {
  return value / frameRateToNumber(rate);
}

function clampPxPerFrame(pxPerFrame: number, rate: FrameRate): number {
  const fps = frameRateToNumber(rate);
  return Math.min(
    MAX_PX_PER_SECOND / fps,
    Math.max(MIN_PX_PER_SECOND / fps, pxPerFrame),
  );
}

// ── Mapping ───────────────────────────────────────────────────────────

/** Screen x of a frame, relative to the left edge of the scrolling strip. */
export function frameToX(view: TimelineView, frame: number): number {
  return frame * view.pxPerFrame - view.scrollLeftPx;
}

/** Frame at a screen x. Rounded — the caller wants a frame, not a fraction. */
export function xToFrame(view: TimelineView, x: number): number {
  return Math.round((x + view.scrollLeftPx) / view.pxPerFrame);
}

/** Frame at a screen x without rounding, for smooth drag deltas. */
export function xToFrameExact(view: TimelineView, x: number): number {
  return (x + view.scrollLeftPx) / view.pxPerFrame;
}

/** Width in pixels of a span of frames. */
export function framesToWidth(view: TimelineView, frames: number): number {
  return frames * view.pxPerFrame;
}

/** Frames spanned by a pixel distance. Used to convert drag deltas. */
export function widthToFrames(view: TimelineView, px: number): number {
  return px / view.pxPerFrame;
}

/**
 * Inclusive frame range currently on screen, padded by `padFrames` so clips
 * partly scrolled off still render their visible edge.
 */
export function visibleFrameRange(
  view: TimelineView,
  padFrames = 0,
): { start: number; end: number } {
  const start = Math.floor(view.scrollLeftPx / view.pxPerFrame) - padFrames;
  const end =
    Math.ceil((view.scrollLeftPx + view.viewportWidthPx) / view.pxPerFrame) + padFrames;
  return { start: Math.max(0, start), end };
}

/** Whether a clip intersects the visible range — the culling test. */
export function isVisible(
  view: TimelineView,
  startFrame: number,
  durationFrames: number,
  padFrames = 0,
): boolean {
  const { start, end } = visibleFrameRange(view, padFrames);
  return startFrame < end && startFrame + durationFrames > start;
}

/**
 * Scrollable width.
 *
 * Derived from where the content actually ends plus a fixed tail, never from a
 * stored project duration. The old model padded a `duration` field that only
 * grew, so deleting the last clip left the timeline stretched.
 */
export function contentWidthPx(view: TimelineView, contentEndFrame: number): number {
  return Math.max(
    view.viewportWidthPx,
    contentEndFrame * view.pxPerFrame + TAIL_PAD_PX,
  );
}

/** Largest valid scroll offset for the current content and viewport. */
export function maxScrollLeftPx(view: TimelineView, contentEndFrame: number): number {
  return Math.max(0, contentWidthPx(view, contentEndFrame) - view.viewportWidthPx);
}

export function clampScroll(view: TimelineView, contentEndFrame: number): TimelineView {
  const clamped = Math.max(
    0,
    Math.min(view.scrollLeftPx, maxScrollLeftPx(view, contentEndFrame)),
  );
  return clamped === view.scrollLeftPx ? view : { ...view, scrollLeftPx: clamped };
}

// ── Zoom ──────────────────────────────────────────────────────────────

/**
 * Zooms about a fixed point on screen.
 *
 * Whatever frame sits under `anchorX` stays under `anchorX` afterwards. This is
 * the whole feel of a timeline: zooming toward the cursor keeps the thing you
 * are looking at where you are looking, so you can dive from a whole programme
 * to a single frame without losing your place.
 */
export function zoomAt(
  view: TimelineView,
  anchorX: number,
  factor: number,
  rate: FrameRate,
  contentEndFrame = 0,
): TimelineView {
  const nextPxPerFrame = clampPxPerFrame(view.pxPerFrame * factor, rate);
  if (nextPxPerFrame === view.pxPerFrame) return view;

  // The frame under the anchor, in content space, must not move.
  const anchorFrame = (view.scrollLeftPx + anchorX) / view.pxPerFrame;
  const scrollLeftPx = anchorFrame * nextPxPerFrame - anchorX;

  return clampScroll(
    { ...view, pxPerFrame: nextPxPerFrame, scrollLeftPx },
    contentEndFrame,
  );
}

/** Zooms about the centre of the viewport, for keyboard zoom. */
export function zoomCentered(
  view: TimelineView,
  factor: number,
  rate: FrameRate,
  contentEndFrame = 0,
): TimelineView {
  return zoomAt(view, view.viewportWidthPx / 2, factor, rate, contentEndFrame);
}

/** Scales so a frame range fills the viewport, with a little breathing room. */
export function zoomToRange(
  view: TimelineView,
  startFrame: number,
  endFrame: number,
  rate: FrameRate,
  marginPx = 24,
): TimelineView {
  const frames = Math.max(1, endFrame - startFrame);
  const usable = Math.max(1, view.viewportWidthPx - marginPx * 2);
  const pxPerFrame = clampPxPerFrame(usable / frames, rate);
  return {
    ...view,
    pxPerFrame,
    scrollLeftPx: Math.max(0, startFrame * pxPerFrame - marginPx),
  };
}

/** Fits all content in the viewport. An empty timeline gets a default scale. */
export function fitToWindow(
  view: TimelineView,
  contentEndFrame: number,
  rate: FrameRate,
): TimelineView {
  if (contentEndFrame <= 0) {
    // Nothing to fit: show a minute or so, which is a sane place to start.
    return {
      ...view,
      pxPerFrame: clampPxPerFrame(pxPerFrameFromPxPerSecond(16, rate), rate),
      scrollLeftPx: 0,
    };
  }
  return zoomToRange(view, 0, contentEndFrame, rate);
}

// ── Scrolling ─────────────────────────────────────────────────────────

/**
 * Scrolls the minimum distance needed to bring a frame into view, keeping a
 * margin so the playhead never sits flush against an edge.
 */
export function scrollToFrame(
  view: TimelineView,
  frame: number,
  contentEndFrame: number,
  marginPx = 80,
): TimelineView {
  const x = frameToX(view, frame);
  if (x >= marginPx && x <= view.viewportWidthPx - marginPx) return view;

  const target =
    x < marginPx
      ? frame * view.pxPerFrame - marginPx
      : frame * view.pxPerFrame - view.viewportWidthPx + marginPx;

  return clampScroll({ ...view, scrollLeftPx: Math.max(0, target) }, contentEndFrame);
}

/** Centres a frame in the viewport, for playhead-follow during playback. */
export function centerOnFrame(
  view: TimelineView,
  frame: number,
  contentEndFrame: number,
): TimelineView {
  const scrollLeftPx = frame * view.pxPerFrame - view.viewportWidthPx / 2;
  return clampScroll(
    { ...view, scrollLeftPx: Math.max(0, scrollLeftPx) },
    contentEndFrame,
  );
}

// ── Ruler ─────────────────────────────────────────────────────────────

export interface RulerTick {
  frame: number;
  x: number;
  major: boolean;
}

/**
 * Tick spacings in seconds, chosen so labels stay readable at every zoom.
 * Below one second the step drops to individual frames.
 */
const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/**
 * Ticks for the visible range, at the finest spacing that keeps labels at
 * least `minLabelGapPx` apart.
 *
 * Generates only what is on screen, so the cost does not grow with project
 * length — the previous implementation walked the entire project duration in
 * fixed steps on every render.
 */
export function rulerTicks(
  view: TimelineView,
  rate: FrameRate,
  minLabelGapPx = 90,
): RulerTick[] {
  const fps = frameRateToNumber(rate);
  const { start, end } = visibleFrameRange(view);

  let stepFrames: number;
  const pxPerSec = view.pxPerFrame * fps;

  if (pxPerSec >= minLabelGapPx) {
    // Sub-second: step in whole frames, then 2, 5, 10 frames as we zoom out.
    const frameSteps = [1, 2, 5, 10, 15, 30];
    stepFrames =
      frameSteps.find((s) => s * view.pxPerFrame >= minLabelGapPx) ?? Math.round(fps);
  } else {
    const seconds =
      SECOND_STEPS.find((s) => s * pxPerSec >= minLabelGapPx) ??
      SECOND_STEPS[SECOND_STEPS.length - 1];
    stepFrames = Math.max(1, Math.round(seconds * fps));
  }

  const ticks: RulerTick[] = [];
  const first = Math.floor(start / stepFrames) * stepFrames;
  for (let frame = Math.max(0, first); frame <= end; frame += stepFrames) {
    ticks.push({
      frame,
      x: frameToX(view, frame),
      // Every fifth tick is emphasised, giving a coarse grid to read against.
      major: (frame / stepFrames) % 5 === 0,
    });
  }
  return ticks;
}

// ── Snapping ──────────────────────────────────────────────────────────

/**
 * Snaps a frame to the nearest candidate within a pixel threshold.
 *
 * The threshold is in pixels, not frames, so snapping feels the same at every
 * zoom: it engages when the target is visually close, rather than when it is
 * numerically close.
 */
export function snapFrame(
  view: TimelineView,
  frame: number,
  candidates: readonly number[],
  thresholdPx = 8,
): { frame: number; snapped: number | null } {
  const thresholdFrames = thresholdPx / view.pxPerFrame;
  let best: number | null = null;
  let bestDistance = thresholdFrames;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate - frame);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best === null ? { frame, snapped: null } : { frame: best, snapped: best };
}
