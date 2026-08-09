/**
 * Pointer interactions on the timeline: scrubbing, dragging, trimming.
 *
 * Each one follows the same shape — capture the pointer, translate movement
 * into frames through the geometry, apply edits live, and commit one undo step
 * on release. Escape aborts and restores the pre-drag document.
 *
 * All positions are frames. Nothing here touches seconds.
 */

import { clipEndFrame, findClip, snapFrames, type ProjectDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import {
  applyEdit,
  beginInteraction,
  commitInteraction,
  abortInteraction,
  doc,
  setPlayheadFrame,
} from "@/stores/project-store";
import { timelineState } from "@/stores/timeline-store";
import { snapFrame, contentXToFrame, widthToFrames } from "@/lib/timeline-geometry";
import {
  timelineView,
  scrollLeftPx,
  setScrollLeft,
} from "@/stores/timeline-view-store";
import { createSignal } from "solid-js";
import { TRACK_HEADER_WIDTH_PX } from "./TrackHeader";

/** Frame the drag is snapping to, for the guide line. Null when not snapping. */
const [snapGuideFrame, setSnapGuideFrame] = createSignal<number | null>(null);
export { snapGuideFrame };

/** Pixels a pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 3;

/**
 * Content x of a pointer, measured against the scrolling strip.
 *
 * The strip's left edge is *not* frame zero: the sticky track headers occupy
 * the first `TRACK_HEADER_WIDTH_PX`, and everything positioned in content
 * space (clips, ruler ticks, the playhead) sits to their right. Measuring from
 * the strip without subtracting that gutter puts every click a header-width
 * late.
 *
 * The strip's own rect already accounts for scrolling, so nothing else needs
 * to be subtracted.
 */
function contentXFromClient(strip: Element, clientX: number): number {
  return clientX - strip.getBoundingClientRect().left - TRACK_HEADER_WIDTH_PX;
}

function candidates(excludeClipId?: string): number[] {
  return timelineState.snapEnabled ? snapFrames(doc(), excludeClipId) : [];
}

/**
 * Runs a pointer drag to completion.
 *
 * `onMove` receives the frame under the pointer and the frame delta since the
 * start. Returning without committing (Escape, or no movement past the
 * threshold) leaves the document untouched.
 */
function trackPointer(
  event: PointerEvent,
  options: {
    label: string;
    icon?: string;
    /** Called once, only when movement first exceeds the threshold. */
    onStart?: () => void;
    onMove: (frame: number, deltaFrames: number, event: PointerEvent) => void;
    onEnd?: () => void;
  },
): void {
  const startX = event.clientX;
  const target = event.currentTarget as HTMLElement | null;
  const strip = target?.closest("[data-timeline-strip]") as HTMLElement | null;
  if (!strip) return;

  let started = false;
  let aborted = false;

  const frameAt = (clientX: number): number =>
    Math.max(0, contentXToFrame(timelineView(), contentXFromClient(strip, clientX)));

  const onMove = (moveEvent: PointerEvent) => {
    const travelled = Math.abs(moveEvent.clientX - startX);
    if (!started) {
      if (travelled < DRAG_THRESHOLD_PX) return;
      started = true;
      beginInteraction();
      options.onStart?.();
    }
    const deltaFrames = widthToFrames(timelineView(), moveEvent.clientX - startX);
    options.onMove(frameAt(moveEvent.clientX), deltaFrames, moveEvent);
  };

  const finish = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
    setSnapGuideFrame(null);

    if (started) {
      if (aborted) abortInteraction();
      else commitInteraction(options.label, options.icon);
    }
    options.onEnd?.();
  };

  const onUp = () => finish();

  const onKey = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    aborted = true;
    finish();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  // Capture phase so the command registry's Escape binding does not win.
  window.addEventListener("keydown", onKey, true);
}

// ── Scrubbing ─────────────────────────────────────────────────────────

/** Drags the playhead. Not an edit, so it records no undo step. */
export function beginScrub(event: PointerEvent): void {
  const strip = (event.currentTarget as HTMLElement).closest("[data-timeline-strip]");
  if (!strip) return;

  const frameAt = (clientX: number) =>
    Math.max(0, contentXToFrame(timelineView(), contentXFromClient(strip, clientX)));

  setPlayheadFrame(frameAt(event.clientX));

  const onMove = (moveEvent: PointerEvent) => {
    setPlayheadFrame(frameAt(moveEvent.clientX));

    // Auto-scroll when dragging past an edge, so you can scrub beyond the
    // visible range without letting go.
    const rect = strip.getBoundingClientRect();
    const overshootLeft = rect.left - moveEvent.clientX;
    const overshootRight = moveEvent.clientX - rect.right;
    if (overshootLeft > 0) setScrollLeft(scrollLeftPx() - Math.min(40, overshootLeft));
    else if (overshootRight > 0) {
      setScrollLeft(scrollLeftPx() + Math.min(40, overshootRight));
    }
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// ── Clip drag ─────────────────────────────────────────────────────────

export function beginClipDrag(
  event: PointerEvent,
  trackId: string,
  clipId: string,
): void {
  const found = findClip(doc(), clipId);
  if (!found) return;

  const originalStart = found.clip.startFrame;
  const duration = found.clip.durationFrames;
  const snapTargets = candidates(clipId);

  trackPointer(event, {
    label: "Move clip",
    icon: "↔",
    onMove: (_frame, deltaFrames) => {
      const wanted = Math.max(0, Math.round(originalStart + deltaFrames));

      // Snap either edge, whichever is closer — butting a clip up against the
      // next one is as common as aligning its head.
      const head = snapFrame(timelineView(), wanted, snapTargets);
      const tail = snapFrame(timelineView(), wanted + duration, snapTargets);

      let start = wanted;
      let guide: number | null = null;
      if (head.snapped !== null) {
        start = head.frame;
        guide = head.snapped;
      } else if (tail.snapped !== null) {
        start = tail.frame - duration;
        guide = tail.snapped;
      }
      setSnapGuideFrame(guide);

      applyEdit("Move clip", (d) =>
        edits.moveClip(d, trackId, clipId, Math.max(0, start)),
      );
    },
  });
}

// ── Trim ──────────────────────────────────────────────────────────────

export function beginTrim(
  event: PointerEvent,
  trackId: string,
  clipId: string,
  side: "start" | "end",
): void {
  event.stopPropagation();

  const found = findClip(doc(), clipId);
  if (!found) return;

  const originalStart = found.clip.startFrame;
  const originalEnd = clipEndFrame(found.clip);
  const snapTargets = candidates(clipId);

  trackPointer(event, {
    label: "Trim clip",
    icon: side === "start" ? "⟵" : "⟶",
    onMove: (_frame, deltaFrames) => {
      const anchor = side === "start" ? originalStart : originalEnd;
      const wanted = Math.round(anchor + deltaFrames);
      const { frame, snapped } = snapFrame(timelineView(), wanted, snapTargets);
      setSnapGuideFrame(snapped);

      applyEdit("Trim clip", (d) =>
        side === "start"
          ? edits.trimClipStart(d, trackId, clipId, frame)
          : edits.trimClipEnd(d, trackId, clipId, frame),
      );
    },
  });
}

// ── Slip, slide and roll ──────────────────────────────────────────────

/**
 * Slip: change what a clip shows without moving it.
 *
 * Dragging right shows *later* material, which means dragging the picture
 * leftward under a fixed window — the same convention every NLE uses, and the
 * reason the delta is negated.
 */
export function beginSlip(event: PointerEvent, trackId: string, clipId: string): void {
  event.stopPropagation();
  const found = findClip(doc(), clipId);
  if (!found) return;

  const originalIn = found.clip.inPointFrames;
  const speed = found.clip.speed;

  trackPointer(event, {
    label: "Slip clip",
    icon: "⇔",
    onMove: (_frame, deltaFrames) => {
      const target = Math.round(originalIn - deltaFrames * speed);
      applyEdit("Slip clip", (d) => edits.slipClipTo(d, trackId, clipId, target));
    },
  });
}

/**
 * Slide: move a clip between its neighbours, which absorb the difference.
 *
 * The clip keeps its content and duration; the cuts either side of it move.
 */
export function beginSlide(event: PointerEvent, trackId: string, clipId: string): void {
  event.stopPropagation();
  const found = findClip(doc(), clipId);
  if (!found) return;

  const originalStart = found.clip.startFrame;
  const snapTargets = candidates(clipId);

  trackPointer(event, {
    label: "Slide clip",
    icon: "⇹",
    onMove: (_frame, deltaFrames) => {
      const wanted = Math.round(originalStart + deltaFrames);
      const { frame, snapped } = snapFrame(timelineView(), wanted, snapTargets);
      setSnapGuideFrame(snapped);
      applyEdit("Slide clip", (d) => edits.slideClipTo(d, trackId, clipId, frame));
    },
  });
}

/**
 * Roll: move the cut between two clips without changing the total length.
 *
 * Grabbed from the clip on the *left* of the cut, which is what the edge
 * handle passes in.
 */
export function beginRoll(
  event: PointerEvent,
  trackId: string,
  leftClipId: string,
): void {
  event.stopPropagation();
  const found = findClip(doc(), leftClipId);
  if (!found) return;

  const originalCut = clipEndFrame(found.clip);
  const snapTargets = candidates(leftClipId);

  trackPointer(event, {
    label: "Roll edit",
    icon: "⇎",
    onMove: (_frame, deltaFrames) => {
      const wanted = Math.round(originalCut + deltaFrames);
      const { frame, snapped } = snapFrame(timelineView(), wanted, snapTargets);
      setSnapGuideFrame(snapped);
      applyEdit("Roll edit", (d) => edits.rollEditTo(d, trackId, leftClipId, frame));
    },
  });
}

/**
 * Ripple trim: trim an edge and move everything after it to match.
 *
 * The same gesture as an ordinary trim, so it is the same handle with a
 * modifier held rather than a separate grab target.
 */
export function beginRippleTrim(
  event: PointerEvent,
  trackId: string,
  clipId: string,
  side: "start" | "end",
): void {
  event.stopPropagation();
  const found = findClip(doc(), clipId);
  if (!found) return;

  const anchor = side === "start" ? found.clip.startFrame : clipEndFrame(found.clip);
  const snapTargets = candidates(clipId);

  trackPointer(event, {
    label: "Ripple trim",
    icon: side === "start" ? "⟸" : "⟹",
    onMove: (_frame, deltaFrames) => {
      const wanted = Math.round(anchor + deltaFrames);
      const { frame, snapped } = snapFrame(timelineView(), wanted, snapTargets);
      setSnapGuideFrame(snapped);
      // The target is absolute and the shift is computed from the clip'''s
      // current end, so re-applying during a drag converges on the pointer
      // rather than accumulating one ripple per pointer move.
      applyEdit("Ripple trim", (d) => {
        edits.rippleTrim(d, trackId, clipId, side, frame);
      });
    },
  });
}

// ── Markers ───────────────────────────────────────────────────────────

/** Drags a marker along the timeline, snapping to clip edges. */
export function beginMarkerDrag(event: PointerEvent, markerId: string): void {
  const marker = doc().markers.find((m) => m.id === markerId);
  if (!marker) return;

  const originalFrame = marker.frame;
  const snapTargets = candidates();

  trackPointer(event, {
    label: "Move marker",
    icon: "🔖",
    onMove: (_frame, deltaFrames) => {
      const wanted = Math.max(0, Math.round(originalFrame + deltaFrames));
      const { frame, snapped } = snapFrame(timelineView(), wanted, snapTargets);
      setSnapGuideFrame(snapped);
      applyEdit("Move marker", (d) => edits.updateMarker(d, markerId, { frame }));
    },
  });
}

// ── Captions ──────────────────────────────────────────────────────────

/**
 * Drags a caption: the whole cue, or one of its edges.
 *
 * Absolute like every other drag — the target is computed from where the
 * gesture started, not accumulated from the last pointer move.
 */
export function beginCueDrag(
  event: PointerEvent,
  cueId: string,
  mode: "move" | "start" | "end",
): void {
  const cue = doc().subtitles.find((c) => c.id === cueId);
  if (!cue) return;

  const original = { start: cue.startFrame, end: cue.endFrame };
  const length = original.end - original.start;
  const snapTargets = candidates();

  trackPointer(event, {
    label: mode === "move" ? "Move caption" : "Trim caption",
    icon: "💬",
    onMove: (_frame, deltaFrames) => {
      const anchor = mode === "end" ? original.end : original.start;
      const wanted = Math.max(0, Math.round(anchor + deltaFrames));
      const { frame, snapped } = snapFrame(timelineView(), wanted, snapTargets);
      setSnapGuideFrame(snapped);

      applyEdit("Move caption", (d) => {
        if (mode === "move") {
          edits.updateCue(d, cueId, { startFrame: frame, endFrame: frame + length });
        } else if (mode === "start") {
          edits.updateCue(d, cueId, { startFrame: frame });
        } else {
          edits.updateCue(d, cueId, { endFrame: frame });
        }
      });
    },
  });
}

// ── Razor ─────────────────────────────────────────────────────────────

/** Splits the clip under the pointer. One click, one undo step. */
export function razorAt(trackId: string, clipId: string, frame: number): void {
  applyEdit("Split clip", (d) => edits.splitClip(d, trackId, clipId, frame), {
    icon: "✂",
  });
}

// ── Helpers for views ─────────────────────────────────────────────────

/** Frame under a pointer event, relative to the scrolling strip. */
export function frameFromEvent(event: PointerEvent | MouseEvent): number {
  const strip = (event.currentTarget as HTMLElement).closest("[data-timeline-strip]");
  if (!strip) return 0;
  return Math.max(
    0,
    contentXToFrame(timelineView(), contentXFromClient(strip, event.clientX)),
  );
}

export type { ProjectDoc };
