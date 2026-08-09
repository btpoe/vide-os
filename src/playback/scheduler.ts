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
 */

import { createEffect, onCleanup } from "solid-js";
import {
  primeFrames,
  settleFrame,
  renderFrame,
  type Compositor,
} from "@/renderer/compositor";
import { doc, playheadFrame, setPlayheadFrame } from "@/stores/project-store";
import { contentEndFrame } from "@/model/doc";
import { clock, isPlaying } from "./transport";

export interface PreviewScheduler {
  stop: () => void;
}

/**
 * Starts the preview loop for a compositor.
 *
 * Returns a stop function; call it when the canvas goes away.
 */
export function startPreview(compositor: Compositor): PreviewScheduler {
  let rafId: number | null = null;
  let stopped = false;
  let lastRenderedFrame = -1;
  /** Bumped by the reactive effect below to force a redraw while paused. */
  let dirty = true;
  /** The frame a settle is in flight for, so it is not started twice. */
  let settlingFrame = -1;
  let settleToken = 0;

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
    }

    primeFrames(frame);
    if (!playing) settle(frame);

    // Nothing to do if the picture cannot have changed.
    if (!dirty && frame === lastRenderedFrame) return;

    renderFrame(compositor, frame);
    lastRenderedFrame = frame;
    dirty = false;
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

  return { stop };
}

/** Forces a redraw — call after a resize, which the loop cannot observe. */
export function invalidatePreview(compositor: Compositor): void {
  renderFrame(compositor, clock.isPlaying() ? clock.nowFrame() : playheadFrame());
}
