/**
 * The preview scheduler.
 *
 * Drives the compositor from the timeline clock at whatever rate the display
 * can manage, with **one render in flight at a time** — enforced structurally,
 * because `renderFrame` is now synchronous.
 *
 * It also re-renders whenever anything the picture depends on changes, not just
 * when the playhead moves. Previously the loop only redrew on a playhead
 * change, so adjusting an effect slider, editing a title, toggling a track or
 * adding a clip left the preview showing a stale frame until you nudged the
 * playhead.
 *
 * It owns the quality ladder as well, because it is the only place that knows
 * how long a frame took. The panel owns the *base* size; the rung is scheduling
 * policy and lives here.
 */

import { createEffect, onCleanup } from "solid-js";
import {
  primeFrames,
  settleFrame,
  renderFrame,
  resizeCompositor,
  type Compositor,
} from "@/renderer/compositor";
import { doc, playheadFrame, setPlayheadFrame } from "@/stores/project-store";
import { contentEndFrame } from "@/model/doc";
import { clock, isPlaying } from "./transport";
import {
  expectedIntervalMs,
  newLadder,
  observeFrame,
  settledLadder,
  sizeForRung,
  type QualityLadder,
} from "./preview-quality";
import { frameRateToNumber } from "@/lib/timecode";

/** What the debug HUD reads, and what the tests assert on. */
export interface PreviewStats {
  ladder: QualityLadder;
  /** The size render targets are currently at. */
  size: { width: number; height: number };
  /**
   * Sequence frames that passed under the playhead without being drawn.
   *
   * Counted rather than inferred from a frame rate: at 60 Hz on a 30 fps
   * sequence the loop legitimately renders the same frame twice, and at 30 Hz
   * on a 60 fps sequence it legitimately cannot draw them all. What is worth
   * showing is which frames were actually skipped.
   */
  droppedFrames: number;
  renderedFrames: number;
  /**
   * Passes where nothing the scene asked for was decoded, so the previous
   * picture was held.
   *
   * Worth surfacing because this is what a flickering preview looks like from
   * the inside: before the render pass learned to hold the last picture, each
   * one of these was a black frame on screen.
   */
  heldFrames: number;
  /** Time inside the last `renderFrame`, and since the previous one. */
  lastRenderMs: number;
  lastIntervalMs: number;
}

export interface PreviewScheduler {
  stop: () => void;
  /** The current quality rung, for the debug HUD and for tests. */
  quality: () => QualityLadder;
  /** A snapshot of what the loop is doing, for the debug HUD. */
  stats: () => PreviewStats;
}

export interface PreviewOptions {
  /**
   * The size full quality renders at. Defaults to whatever the compositor was
   * built at, so a caller that does not care gets today's behaviour.
   */
  baseSize?: () => { width: number; height: number };
}

/**
 * Starts the preview loop for a compositor.
 *
 * Returns a stop function; call it when the canvas goes away.
 */
export function startPreview(
  compositor: Compositor,
  options: PreviewOptions = {},
): PreviewScheduler {
  let rafId: number | null = null;
  let stopped = false;
  let lastRenderedFrame = -1;
  /** Bumped by the reactive effect below to force a redraw while paused. */
  let dirty = true;
  /** The frame a settle is in flight for, so it is not started twice. */
  let settlingFrame = -1;
  let settleToken = 0;

  let ladder = newLadder();
  let lastRenderAt = 0;
  let droppedFrames = 0;
  let renderedFrames = 0;
  let heldFrames = 0;
  let lastRenderMs = 0;
  let lastIntervalMs = 0;
  const initialSize = { width: compositor.width, height: compositor.height };
  const baseSize = options.baseSize ?? (() => initialSize);

  /**
   * Decodes what a paused frame needs, then asks for a redraw.
   *
   * The render pass never waits, and while paused there is no next frame to
   * repeat into — so without this the preview stayed black until playback
   * started. The token guards against a slow decode landing after the playhead
   * has moved on and marking a stale frame ready.
   */
  const settle = (frame: number) => {
    if (settlingFrame === frame) return;
    settlingFrame = frame;
    const token = ++settleToken;

    void settleFrame(frame).then(() => {
      if (stopped || token !== settleToken) return;
      dirty = true;
    });
  };

  /** Applies the current rung to the render targets, if it has moved. */
  const applyQuality = () => {
    const { width, height } = sizeForRung(baseSize(), ladder);
    if (compositor.width === width && compositor.height === height) return;
    resizeCompositor(compositor, width, height);
    dirty = true;
  };

  const loop = () => {
    if (stopped) return;
    rafId = requestAnimationFrame(loop);

    const playing = clock.isPlaying();
    // While playing the clock is the authority; while paused the playhead is,
    // because the timeline, the marker list and the caption list all move it
    // directly and none of them goes through the transport.
    const frame = playing ? clock.nowFrame() : playheadFrame();

    if (playing) {
      // Stop at the end of the content rather than running into empty space.
      const end = contentEndFrame(doc());
      if (end > 0 && frame >= end) {
        clock.pause();
        clock.seekFrame(end);
        setPlayheadFrame(end);
        dirty = true;
        return;
      }
      setPlayheadFrame(frame);
    } else {
      // A settled playhead is the frame people look at, so it gets full size.
      ladder = settledLadder(ladder);
    }

    primeFrames(frame);
    if (!playing) settle(frame);

    applyQuality();

    // Nothing to do if the picture cannot have changed.
    if (!dirty && frame === lastRenderedFrame) return;

    // Frames the playhead passed over without one being drawn. Only while
    // playing: a scrub is *meant* to skip frames, and counting it would make
    // the HUD's dropped count a measure of how much the user moved the mouse.
    if (playing && lastRenderedFrame >= 0 && frame > lastRenderedFrame + 1) {
      droppedFrames += frame - lastRenderedFrame - 1;
    }

    const startedAt = performance.now();
    const complete = renderFrame(compositor, frame);
    const finishedAt = performance.now();

    lastRenderMs = finishedAt - startedAt;
    lastIntervalMs = lastRenderAt > 0 ? startedAt - lastRenderAt : 0;

    // Only a pass that actually drew says anything about how long a frame
    // takes. A held frame is cheap precisely because it did no work, and
    // feeding it to the ladder would read a stalled decoder as a fast GPU.
    if (playing && complete && lastRenderAt > 0) {
      ladder = observeFrame(ladder, {
        renderMs: lastRenderMs,
        intervalMs: lastIntervalMs,
        // The gap between renders is one *sequence* frame, not one display
        // frame. Measuring it against the display's is what collapsed every
        // 24 and 30 fps timeline to the bottom rung the moment playback began.
        intervalBudgetMs: expectedIntervalMs(
          frameRateToNumber(doc().sequence.frameRate),
        ),
      });
    }

    lastRenderAt = startedAt;
    dirty = false;

    if (complete) {
      lastRenderedFrame = frame;
      renderedFrames++;
    } else {
      // Deliberately not recorded as rendered: the frame is still owed, so the
      // next pass over it must draw rather than take the early return above.
      heldFrames++;
    }
  };

  rafId = requestAnimationFrame(loop);

  /**
   * Marks the preview dirty when the document, the playhead or playback state
   * changes. Reading them here is what subscribes us.
   */
  createEffect(() => {
    doc();
    playheadFrame();
    isPlaying();
    dirty = true;
    // An edit can change what a frame is made of without moving the playhead —
    // adding a clip, unmuting a track — so the settle has to run again for a
    // frame it has already run for.
    settlingFrame = -1;
  });

  const stop = () => {
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  };
  onCleanup(stop);

  return {
    stop,
    quality: () => ladder,
    stats: () => ({
      ladder,
      size: { width: compositor.width, height: compositor.height },
      droppedFrames,
      renderedFrames,
      heldFrames,
      lastRenderMs,
      lastIntervalMs,
    }),
  };
}

/** Forces a redraw — call after a resize, which the loop cannot observe. */
export function invalidatePreview(compositor: Compositor): void {
  renderFrame(compositor, clock.isPlaying() ? clock.nowFrame() : playheadFrame());
}
