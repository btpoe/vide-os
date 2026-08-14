import { describe, it, expect } from "vitest";
import {
  BASE_SCALES,
  FRAME_BUDGET_MS,
  QUALITY_RUNGS,
  baseSizeForScale,
  chooseBaseScale,
  expectedIntervalMs,
  newLadder,
  observeFrame,
  rungScale,
  settledLadder,
  sizeForRung,
  type FrameCost,
  type QualityLadder,
} from "@/playback/preview-quality";

/**
 * The quality ladder's policy.
 *
 * What is worth asserting is not "it goes down when slow" but the two things
 * that decide whether it feels right: that it does not oscillate, and that a
 * stationary playhead always ends up at full quality.
 */

const fast: FrameCost = { renderMs: 1, intervalMs: 16 };
const slow: FrameCost = { renderMs: 40, intervalMs: 40 };
/** Neither a strike nor credit: over half the budget, under all of it. */
const middling: FrameCost = { renderMs: FRAME_BUDGET_MS * 0.75, intervalMs: 17 };

function feed(ladder: QualityLadder, cost: FrameCost, times: number): QualityLadder {
  let current = ladder;
  for (let i = 0; i < times; i++) current = observeFrame(current, cost);
  return current;
}

describe("dropping a rung", () => {
  it("takes more than one slow frame", () => {
    expect(observeFrame(newLadder(), slow).rung).toBe(0);
    expect(feed(newLadder(), slow, 2).rung).toBe(0);
    expect(feed(newLadder(), slow, 3).rung).toBe(1);
  });

  it("stops at the bottom of the ladder", () => {
    const bottom = feed(newLadder(), slow, 300);
    expect(bottom.rung).toBe(QUALITY_RUNGS.length - 1);
    expect(rungScale(bottom)).toBe(QUALITY_RUNGS[QUALITY_RUNGS.length - 1]);
  });

  it("notices a late frame even when the render call was cheap", () => {
    // Scaling render targets buys GPU fill rate, and GPU time is not visible
    // from `performance.now()` around a GL call: the calls return promptly and
    // the next animation frame arrives late instead. A ladder watching only
    // `renderMs` would never engage on the case it exists for.
    const gpuBound: FrameCost = { renderMs: 0.5, intervalMs: 45 };
    expect(feed(newLadder(), gpuBound, 3).rung).toBe(1);
  });

  it("forgets strikes that are not consecutive", () => {
    let ladder = feed(newLadder(), slow, 2);
    ladder = observeFrame(ladder, fast);
    ladder = feed(ladder, slow, 2);
    expect(ladder.rung).toBe(0);
  });
});

describe("the cadence a sequence is expected to render at", () => {
  // The bug this whole block exists for: the loop draws once per *sequence*
  // frame, so on a 30 fps timeline consecutive renders are 33 ms apart however
  // idle the machine is. Measured against the display's 16.7 ms, every one of
  // them was a strike — so the ladder fell to its bottom rung within a third of
  // a second of pressing play and could never climb back, and a 1080p timeline
  // previewed at 240×135 with the renderer at 6 ms of a 16.7 ms budget.

  it("is a frame of the sequence, floored at a frame of the display", () => {
    expect(expectedIntervalMs(30)).toBeCloseTo(1000 / 30, 6);
    expect(expectedIntervalMs(24)).toBeCloseTo(1000 / 24, 6);
    // Nothing can be drawn more often than the display refreshes.
    expect(expectedIntervalMs(240)).toBeCloseTo(FRAME_BUDGET_MS, 6);
    expect(expectedIntervalMs(0)).toBeCloseTo(FRAME_BUDGET_MS, 6);
  });

  it("does not drop a rung on a 30 fps sequence running at its own rate", () => {
    const onCadence: FrameCost = {
      renderMs: 6,
      intervalMs: 1000 / 30,
      intervalBudgetMs: expectedIntervalMs(30),
    };
    expect(feed(newLadder(), onCadence, 300).rung).toBe(0);
  });

  it("does not drop a rung on a 24 fps sequence either", () => {
    // 24 fps frames land on irregular 60 Hz boundaries, so the gap alternates
    // between one and two display frames of slack. Neither is a stall.
    const budget = expectedIntervalMs(24);
    let ladder = newLadder();
    for (let i = 0; i < 300; i++) {
      ladder = observeFrame(ladder, {
        renderMs: 6,
        intervalMs: i % 2 === 0 ? 33.3 : 50,
        intervalBudgetMs: budget,
      });
    }
    expect(ladder.rung).toBe(0);
  });

  it("climbs back to full on a 30 fps sequence that is keeping up", () => {
    const dropped = feed(newLadder(), slow, 3);
    const onCadence: FrameCost = {
      renderMs: 6,
      intervalMs: 1000 / 30,
      intervalBudgetMs: expectedIntervalMs(30),
    };
    expect(feed(dropped, onCadence, 45).rung).toBe(0);
  });

  it("still catches a genuine stall on a 30 fps sequence", () => {
    // Half rate. The point of the fix is a correct reference, not a ladder
    // that has stopped engaging.
    const stalled: FrameCost = {
      renderMs: 6,
      intervalMs: 1000 / 15,
      intervalBudgetMs: expectedIntervalMs(30),
    };
    expect(feed(newLadder(), stalled, 3).rung).toBe(1);
  });

  it("never lets a cadence finer than the display excuse a slow frame", () => {
    // A caller passing nonsense must not widen the budget below the display's.
    const cost: FrameCost = { renderMs: 1, intervalMs: 40, intervalBudgetMs: 1 };
    expect(feed(newLadder(), cost, 3).rung).toBe(1);
  });
});

describe("climbing back", () => {
  it("needs sustained headroom, not one good frame", () => {
    const dropped = feed(newLadder(), slow, 3);
    expect(feed(dropped, fast, 10).rung).toBe(1);
    expect(feed(dropped, fast, 45).rung).toBe(0);
  });

  it("does not creep up on frames that are merely not slow", () => {
    // The oscillation case. A frame at three quarters of the budget is not a
    // strike, but treating it as credit is what walks the ladder up into a
    // stutter and then straight back down — which shimmers.
    const dropped = feed(newLadder(), slow, 3);
    expect(feed(dropped, middling, 500).rung).toBe(1);
  });

  it("settles at a rung rather than alternating around one", () => {
    // Alternating slow and fast frames — the shape that a naive one-strike
    // ladder turns into a visible flicker.
    let ladder = newLadder();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      ladder = observeFrame(ladder, i % 2 === 0 ? slow : fast);
      seen.add(ladder.rung);
    }
    expect([...seen]).toEqual([0]);
  });
});

describe("a settled playhead", () => {
  it("returns to full quality however far the ladder had fallen", () => {
    const bottom = feed(newLadder(), slow, 300);
    expect(settledLadder(bottom).rung).toBe(0);
    expect(rungScale(settledLadder(bottom))).toBe(1);
  });

  it("is the same value when it was already full, so nothing reallocates", () => {
    const full = newLadder();
    expect(settledLadder(full)).toBe(full);
  });
});

describe("sizing", () => {
  it("scales the base rather than the sequence", () => {
    const base = { width: 1920, height: 1080 };
    expect(sizeForRung(base, newLadder())).toEqual(base);
    expect(sizeForRung(base, feed(newLadder(), slow, 3))).toEqual({
      width: 960,
      height: 540,
    });
  });

  it("never asks for a zero-sized render target", () => {
    const tiny = sizeForRung({ width: 3, height: 1 }, feed(newLadder(), slow, 300));
    expect(tiny.width).toBeGreaterThanOrEqual(2);
    expect(tiny.height).toBeGreaterThanOrEqual(2);
  });
});

describe("choosing the base", () => {
  const UHD = 3840;
  const HD = 1920;

  it("never renders more than the panel can show", () => {
    // The case this exists for: a 4K project in a 600 px panel was rendering
    // 1920×1080 targets to present them a third of that size.
    const index = chooseBaseScale(0, UHD, 600);
    expect(UHD * BASE_SCALES[index]).toBeGreaterThanOrEqual(600);
    expect(index).toBeGreaterThan(0);
  });

  it("comes back up when the panel is made bigger", () => {
    const small = chooseBaseScale(0, UHD, 600);
    expect(chooseBaseScale(small, UHD, 3000)).toBe(0);
  });

  it("caps at half the sequence however large the panel is", () => {
    expect(chooseBaseScale(0, HD, 100_000)).toBe(0);
    expect(baseSizeForScale({ width: HD, height: 1080 }, 0)).toEqual({
      width: 960,
      height: 540,
    });
  });

  it("holds still while a splitter is dragged across a step", () => {
    // Without the dead band this is a reallocation of every render target on
    // alternate animation frames, for a picture whose size is not changing.
    const step = UHD * BASE_SCALES[1];
    let index = chooseBaseScale(0, UHD, step);
    const seen = new Set([index]);
    for (let i = 0; i < 50; i++) {
      index = chooseBaseScale(index, UHD, step + (i % 2 === 0 ? 12 : -12));
      seen.add(index);
    }
    expect(seen.size).toBe(1);
  });

  it("keeps what it has when there is nothing to measure", () => {
    // An unmounted or zero-height panel. Treating that as "tiny" would drop the
    // preview to its coarsest base and leave it there.
    expect(chooseBaseScale(0, UHD, 0)).toBe(0);
    expect(chooseBaseScale(1, UHD, Number.NaN)).toBe(1);
  });

  it("stops at the coarsest step rather than running off the end", () => {
    const index = chooseBaseScale(0, UHD, 1);
    expect(index).toBe(BASE_SCALES.length - 1);
    expect(baseSizeForScale({ width: 3, height: 1 }, 99).width).toBeGreaterThanOrEqual(
      2,
    );
  });
});
