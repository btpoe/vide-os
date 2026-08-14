/**
 * The preview quality ladder.
 *
 * Phase 4 specified one and did not build it, so the preview rendered at a fixed
 * fraction of the sequence however long a frame took. Under load the only thing
 * that gave way was the frame rate, which is the worst thing to give up: a
 * smaller picture that moves correctly reads as the edit, a full-size picture
 * that stutters does not.
 *
 * Two details decide whether it feels right rather than merely faster, and both
 * are here rather than in the loop:
 *
 * - **Hysteresis.** A frame sitting on the threshold must not oscillate between
 *   rungs, because a preview that changes resolution every other frame shimmers
 *   and reads as a rendering bug. Going down takes a few consecutive slow
 *   frames; coming back up takes most of a second of comfortable ones.
 * - **A settled playhead gets full quality.** A paused frame has all the time in
 *   the world and is the one people actually look at, so the ladder is only
 *   consulted while playing.
 *
 * Pure and stateless-by-value, so the whole policy is testable without a GL
 * context or a clock.
 */

/**
 * Render-target scales, finest first, as a fraction of the preview's base size.
 *
 * Fractions of the *base*, not of the sequence: the panel already previews at
 * half the sequence's resolution, and a ladder that could climb above that would
 * allocate a full set of 4K targets for a 4K project to present them into a
 * canvas half that size.
 */
export const QUALITY_RUNGS = [1, 1 / 2, 1 / 4] as const;

/**
 * 60 Hz. How long a *render* may take: a frame of the display, not of the
 * sequence, because a render that overruns one stalls the compositor.
 */
export const FRAME_BUDGET_MS = 1000 / 60;

/**
 * How far apart rendered frames are expected to be, for a sequence rate.
 *
 * This is emphatically *not* `FRAME_BUDGET_MS`, and conflating the two is a
 * category error that cost this project its preview resolution. A render must
 * fit inside a display frame; but the loop only draws when the sequence frame
 * under the playhead changes, so on a 30 fps timeline consecutive renders are
 * 33 ms apart *by design*, on any machine, however idle. Measuring that gap
 * against the display's 16.7 ms made `tooSlow` true on every frame of every
 * sequence slower than the refresh rate: the ladder fell to its bottom rung
 * within a third of a second of pressing play and could never climb back,
 * because `comfortable` was likewise unreachable. A 1080p timeline previewed at
 * 240×135 while the renderer sat at 6 ms of a 16.7 ms budget.
 *
 * Floored at the display frame, since nothing can be drawn more often than that.
 */
export function expectedIntervalMs(sequenceFps: number): number {
  if (!(sequenceFps > 0)) return FRAME_BUDGET_MS;
  return Math.max(FRAME_BUDGET_MS, 1000 / sequenceFps);
}

/** Consecutive slow frames before dropping a rung. */
const SLOW_STRIKES = 3;
/** Consecutive comfortable frames before climbing one. ~0.75 s at 60 Hz. */
const FAST_STRIKES = 45;

export interface QualityLadder {
  /** Index into `QUALITY_RUNGS`. */
  readonly rung: number;
  readonly slow: number;
  readonly fast: number;
}

export interface FrameCost {
  /** Time spent in `renderFrame`, in milliseconds. */
  renderMs: number;
  /**
   * Time since the previous rendered frame.
   *
   * The second signal, and the important one: `renderMs` is CPU-side submit
   * time, and scaling render targets mostly buys GPU fill rate. When the GPU is
   * the bottleneck the GL calls return promptly and the next animation frame
   * arrives late instead, so the interval is what notices.
   */
  intervalMs: number;
  /** How long one render may take. Defaults to `FRAME_BUDGET_MS`. */
  budgetMs?: number;
  /**
   * How far apart rendered frames are expected to be — `expectedIntervalMs` of
   * the sequence's rate. Defaults to the render budget, which is only correct
   * when the sequence runs at the display's refresh rate.
   */
  intervalBudgetMs?: number;
}

export function newLadder(): QualityLadder {
  return { rung: 0, slow: 0, fast: 0 };
}

export function rungScale(ladder: QualityLadder): number {
  return QUALITY_RUNGS[Math.min(ladder.rung, QUALITY_RUNGS.length - 1)];
}

/**
 * Folds one frame's cost into the ladder.
 *
 * Call only while playing: a paused preview renders once and waits, so its
 * interval says nothing about how fast it could go.
 */
export function observeFrame(ladder: QualityLadder, cost: FrameCost): QualityLadder {
  const budget = cost.budgetMs ?? FRAME_BUDGET_MS;
  // Never below the render budget: the cadence cannot be faster than the
  // display, and a caller that passes nothing gets the old behaviour.
  const cadence = Math.max(cost.intervalBudgetMs ?? budget, budget);

  // 1.5x on the interval rather than 1x: a frame that misses its deadline lands
  // on the next display frame, so the interval jumps in steps and a bare
  // cadence would fire on ordinary jitter.
  const tooSlow = cost.renderMs > budget || cost.intervalMs > cadence * 1.5;
  const comfortable = cost.renderMs < budget / 2 && cost.intervalMs < cadence * 1.2;

  if (tooSlow) {
    const slow = ladder.slow + 1;
    if (slow >= SLOW_STRIKES && ladder.rung < QUALITY_RUNGS.length - 1) {
      return { rung: ladder.rung + 1, slow: 0, fast: 0 };
    }
    return { rung: ladder.rung, slow, fast: 0 };
  }

  if (comfortable) {
    const fast = ladder.fast + 1;
    if (fast >= FAST_STRIKES && ladder.rung > 0) {
      return { rung: ladder.rung - 1, slow: 0, fast: 0 };
    }
    return { rung: ladder.rung, slow: 0, fast };
  }

  // In between: neither a strike nor credit toward climbing. Counting it as
  // credit is what makes a ladder creep upward into a stutter.
  return { rung: ladder.rung, slow: 0, fast: 0 };
}

/** Back to full quality, for a playhead that has stopped moving. */
export function settledLadder(ladder: QualityLadder): QualityLadder {
  return ladder.rung === 0 && ladder.slow === 0 && ladder.fast === 0
    ? ladder
    : newLadder();
}

/** The render-target size for a rung. Never smaller than a usable texture. */
export function sizeForRung(
  base: { width: number; height: number },
  ladder: QualityLadder,
): { width: number; height: number } {
  const scale = rungScale(ladder);
  return {
    width: Math.max(2, Math.round(base.width * scale)),
    height: Math.max(2, Math.round(base.height * scale)),
  };
}

// ── The base the rungs are fractions of ───────────────────────────────

/**
 * Scales of the *sequence* the preview's base size may take, finest first.
 *
 * The base is the top of the ladder — what a settled playhead renders at — and
 * it is chosen from the size the picture is actually displayed at rather than
 * from the project alone. A 4K project previewed into a 600 px panel was
 * rendering 1920×1080 targets and presenting them a third of that size; the
 * ladder only reclaimed that under load, and a paused frame is never under
 * load.
 *
 * Half the sequence is the cap rather than full, for the same reason it always
 * was: nothing above it is visible on any panel a person edits in.
 */
export const BASE_SCALES = [1 / 2, 1 / 4, 1 / 8] as const;

/**
 * How far past a step the display must go before the base follows it.
 *
 * The same argument as the ladder's hysteresis, for a different oscillation:
 * dragging a splitter back and forth across a step would otherwise reallocate
 * every render target on alternate animation frames.
 */
const BASE_DEAD_BAND = 0.05;

/**
 * Picks the base scale for a display size, given the one in use.
 *
 * Discrete rather than continuous — a base that tracked the panel exactly would
 * reallocate on every pixel of a splitter drag, and the difference between
 * rendering 612 and 640 pixels wide is not visible.
 *
 * Returns the current index unchanged when nothing has been measured yet, which
 * is what an unmounted or zero-height panel reports.
 */
export function chooseBaseScale(
  current: number,
  sequenceWidth: number,
  displayedWidth: number,
): number {
  if (!(displayedWidth > 0) || !(sequenceWidth > 0)) return current;

  let index = Math.min(Math.max(current, 0), BASE_SCALES.length - 1);

  // Finer while the panel is showing more pixels than are being rendered.
  while (
    index > 0 &&
    displayedWidth > sequenceWidth * BASE_SCALES[index] * (1 + BASE_DEAD_BAND)
  ) {
    index--;
  }

  // Coarser while the next step down still covers the panel.
  while (
    index < BASE_SCALES.length - 1 &&
    displayedWidth < sequenceWidth * BASE_SCALES[index + 1] * (1 - BASE_DEAD_BAND)
  ) {
    index++;
  }

  return index;
}

/** The base size for a scale index. Never smaller than a usable texture. */
export function baseSizeForScale(
  sequence: { width: number; height: number },
  index: number,
): { width: number; height: number } {
  const scale = BASE_SCALES[Math.min(Math.max(index, 0), BASE_SCALES.length - 1)];
  return {
    width: Math.max(2, Math.round(sequence.width * scale)),
    height: Math.max(2, Math.round(sequence.height * scale)),
  };
}
