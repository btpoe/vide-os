/**
 * The timeline clock.
 *
 * One authoritative source of "where are we", derived from
 * `AudioContext.currentTime` — **unconditionally**, even when the timeline has
 * no audio on it. An AudioContext is a monotonic, drift-free clock regardless
 * of what is connected to it, and making it the master in every case removes
 * the branch along with an entire class of bug.
 *
 * What it replaces: the playhead advanced by accumulating
 * `requestAnimationFrame` deltas while, separately, a `<video>` element was
 * told to `play()` and a third piece of code corrected drift between them at a
 * 0.15 s threshold. Three things with an opinion about the current time, none
 * of them in charge. rAF deltas also stop accumulating when the tab is
 * backgrounded and stutter under load, so the playhead drifted against the
 * audio it was supposedly following.
 *
 * Pure state plus an AudioContext. No Solid, no DOM, no rendering.
 */

import type { FrameRate } from "@/lib/timecode";
import { framesToSeconds, secondsToFrames } from "@/lib/timecode";

/** Shuttle rates for J/K/L. Negative plays backwards. */
export const SHUTTLE_RATES = [-4, -2, -1, -0.5, 0, 0.5, 1, 2, 4] as const;

export interface ClockOptions {
  /** Supplies the context. Injectable so tests can drive time by hand. */
  getContext: () => { currentTime: number } | null;
  frameRate: () => FrameRate;
}

export class TimelineClock {
  /** Timeline position when the current play segment began, in seconds. */
  private anchorSec = 0;
  /** Context time when the current play segment began. */
  private anchorContextTime = 0;
  private rate = 1;
  private playing = false;

  constructor(private readonly options: ClockOptions) {}

  /**
   * The current timeline position in seconds.
   *
   * Continuous, not frame-quantised: quantising here would make the clock jump
   * and would break rate changes. Callers that display or render a position use
   * `nowFrame`.
   */
  nowSec(): number {
    if (!this.playing) return this.anchorSec;
    const context = this.options.getContext();
    if (!context) return this.anchorSec;
    return this.anchorSec + (context.currentTime - this.anchorContextTime) * this.rate;
  }

  /**
   * The current position as an integer frame.
   *
   * Everything user-visible goes through here, so the playhead, the renderer
   * and the export scheduler cannot disagree about which frame is current.
   */
  nowFrame(): number {
    return Math.max(0, secondsToFrames(this.nowSec(), this.options.frameRate()));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  playbackRate(): number {
    return this.rate;
  }

  /**
   * Re-anchors to the present. Called whenever the position or rate changes,
   * so elapsed context time is always measured from a known pairing.
   */
  private reanchor(atSec: number): void {
    const context = this.options.getContext();
    this.anchorSec = Math.max(0, atSec);
    this.anchorContextTime = context?.currentTime ?? 0;
  }

  play(rate = 1): void {
    if (this.playing && this.rate === rate) return;
    // Anchor to where we are *now* before changing rate, or the elapsed time
    // since the last anchor would be re-scaled by the new rate.
    this.reanchor(this.nowSec());
    this.rate = rate;
    this.playing = rate !== 0;
  }

  pause(): void {
    if (!this.playing) return;
    this.anchorSec = this.nowSec();
    this.playing = false;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play(this.rate === 0 ? 1 : this.rate);
  }

  /** Jumps to a position. Keeps playing if it was playing. */
  seekSec(seconds: number): void {
    this.reanchor(seconds);
  }

  seekFrame(frame: number): void {
    this.seekSec(framesToSeconds(Math.max(0, frame), this.options.frameRate()));
  }

  /**
   * Steps by whole frames.
   *
   * Integer arithmetic on the frame index, never `t ± 1/fps` on a float. The
   * old stepper added a float frame duration to a float position, so repeated
   * steps accumulated error and drifted off the frame grid.
   */
  stepFrames(delta: number): void {
    this.pause();
    this.seekFrame(this.nowFrame() + Math.round(delta));
  }

  /** Next shuttle rate in the given direction, for J and L. */
  shuttle(direction: -1 | 1): void {
    const current = this.playing ? this.rate : 0;
    const index = SHUTTLE_RATES.indexOf(current as (typeof SHUTTLE_RATES)[number]);
    const from = index >= 0 ? index : SHUTTLE_RATES.indexOf(0);
    const next = Math.max(0, Math.min(SHUTTLE_RATES.length - 1, from + direction));
    const rate = SHUTTLE_RATES[next];
    if (rate === 0) this.pause();
    else this.play(rate);
  }

  /** Stops and returns to 1x, for K. */
  resetRate(): void {
    this.pause();
    this.rate = 1;
  }
}
