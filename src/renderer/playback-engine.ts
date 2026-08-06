/**
 * Playback engine: rAF-driven timer that advances the playhead
 * and triggers compositor frame renders.
 */

import {
  projectState,
  setPlayhead,
  togglePlayback,
} from "@/stores/project-store";
import { type Compositor, renderFrame, renderBlackFrame } from "./compositor";
import { syncAudio, muteAll } from "./audio-manager";

export interface PlaybackEngine {
  compositor: Compositor;
  animFrameId: number | null;
  lastTimestamp: number;
  disposed: boolean;
}

/**
 * Create a playback engine attached to a compositor.
 */
export function createPlaybackEngine(compositor: Compositor): PlaybackEngine {
  return {
    compositor,
    animFrameId: null,
    lastTimestamp: 0,
    disposed: false,
  };
}

/**
 * Start the render loop. Renders frames continuously.
 * When playing, advances the playhead in real time.
 * When paused, still renders the current frame (for scrubbing).
 */
export function startRenderLoop(engine: PlaybackEngine): void {
  if (engine.disposed) return;

  let lastPlayheadRender = -1;

  const loop = (timestamp: number) => {
    if (engine.disposed) return;

    // Advance playhead if playing
    if (projectState.isPlaying) {
      if (engine.lastTimestamp > 0) {
        const deltaMs = timestamp - engine.lastTimestamp;
        const deltaSec = deltaMs / 1000;
        const newTime = projectState.playheadPosition + deltaSec;

        if (newTime >= projectState.duration) {
          // Stop at end
          setPlayhead(projectState.duration);
          togglePlayback();
        } else {
          setPlayhead(newTime);
        }
      }
      engine.lastTimestamp = timestamp;
    } else {
      engine.lastTimestamp = 0;
    }

    // Sync audio with current playback state
    syncAudio(projectState.playheadPosition, projectState.isPlaying);

    // Render frame if playhead changed or first frame
    const currentPlayhead = projectState.playheadPosition;
    if (
      Math.abs(currentPlayhead - lastPlayheadRender) > 0.001 ||
      lastPlayheadRender < 0
    ) {
      lastPlayheadRender = currentPlayhead;
      renderFrame(engine.compositor, currentPlayhead).catch((err) => {
        console.warn("Render error:", err);
        renderBlackFrame(engine.compositor);
      });
    }

    engine.animFrameId = requestAnimationFrame(loop);
  };

  engine.animFrameId = requestAnimationFrame(loop);
}

/**
 * Stop the render loop.
 */
export function stopRenderLoop(engine: PlaybackEngine): void {
  if (engine.animFrameId !== null) {
    cancelAnimationFrame(engine.animFrameId);
    engine.animFrameId = null;
  }
  engine.lastTimestamp = 0;
  muteAll();
}

/**
 * Dispose the playback engine.
 */
export function disposePlaybackEngine(engine: PlaybackEngine): void {
  engine.disposed = true;
  stopRenderLoop(engine);
  muteAll();
}

/**
 * Force render the current frame (e.g., after scrubbing).
 */
export function renderCurrentFrame(engine: PlaybackEngine): void {
  if (engine.disposed) return;
  renderFrame(engine.compositor, projectState.playheadPosition).catch(() => {
    renderBlackFrame(engine.compositor);
  });
}
