/**
 * The application's single clock, plus the AudioContext that drives it.
 *
 * The context is created lazily on the first user gesture, because browsers
 * refuse to start one otherwise. Until then the clock still works — it simply
 * reports the anchored position — so nothing has to guard against its absence.
 */

import { createSignal, createEffect } from "solid-js";
import { TimelineClock } from "./clock";
import {
  playheadFrame,
  setPlayheadFrame,
  setPlayingMirror,
  sequenceFrameRate,
} from "@/stores/project-store";

let audioContext: AudioContext | null = null;

/**
 * The shared AudioContext.
 *
 * Also the master clock source, which is why it is created even for a timeline
 * with no audio: an AudioContext is a monotonic, drift-free time source
 * regardless of what is connected to it.
 */
export function getAudioContext(): AudioContext | null {
  return audioContext;
}

/**
 * Creates or resumes the context. **Must be called from a user gesture** —
 * every transport control does, which is why this is not called on mount.
 */
export async function ensureAudioContext(): Promise<AudioContext> {
  audioContext ??= new AudioContext({ latencyHint: "interactive" });
  if (audioContext.state === "suspended") await audioContext.resume();
  return audioContext;
}

export const clock = new TimelineClock({
  getContext: () => audioContext,
  frameRate: () => sequenceFrameRate(),
});

const [isPlaying, setIsPlayingSignal] = createSignal(false);
export { isPlaying };

/** Mirrors the clock's state into a signal so the UI can react to it. */
function syncPlayingState(): void {
  setIsPlayingSignal(clock.isPlaying());
  setPlayingMirror(clock.isPlaying());
}

export function togglePlayback(): void {
  void ensureAudioContext().then(() => {
    clock.toggle();
    syncPlayingState();
  });
}

export function play(rate = 1): void {
  void ensureAudioContext().then(() => {
    clock.play(rate);
    syncPlayingState();
  });
}

export function pause(): void {
  clock.pause();
  syncPlayingState();
  // Pausing settles the playhead on a whole frame.
  setPlayheadFrame(clock.nowFrame());
}

export function seekToFrame(frame: number): void {
  clock.seekFrame(frame);
  setPlayheadFrame(clock.nowFrame());
}

export function stepFrames(delta: number): void {
  clock.stepFrames(delta);
  syncPlayingState();
  setPlayheadFrame(clock.nowFrame());
}

export function shuttle(direction: -1 | 1): void {
  void ensureAudioContext().then(() => {
    clock.shuttle(direction);
    syncPlayingState();
  });
}

/**
 * Keeps the clock in step when something else moves the playhead — clicking a
 * lane, a menu command, undo. Without this the clock would keep counting from
 * its own anchor and snap back on the next tick.
 */
export function initTransport(): void {
  createEffect(() => {
    const frame = playheadFrame();
    if (!clock.isPlaying() && clock.nowFrame() !== frame) {
      clock.seekFrame(frame);
    }
  });
}
