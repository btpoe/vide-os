import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  type TimelineView,
  MIN_PX_PER_SECOND,
  MAX_PX_PER_SECOND,
  TAIL_PAD_PX,
  pxPerSecond,
  pxPerFrameFromPxPerSecond,
  frameToX,
  xToFrame,
  xToFrameExact,
  framesToWidth,
  widthToFrames,
  visibleFrameRange,
  isVisible,
  contentWidthPx,
  maxScrollLeftPx,
  clampScroll,
  zoomAt,
  zoomCentered,
  zoomToRange,
  fitToWindow,
  scrollToFrame,
  centerOnFrame,
  rulerTicks,
  snapFrame,
} from "@/lib/timeline-geometry";
import { FPS_24, FPS_29_97, FPS_30, FPS_60, frameRateToNumber } from "@/lib/timecode";

/** 30fps, 2px per frame (60px/s), 1000px wide, scrolled to the start. */
function view(overrides: Partial<TimelineView> = {}): TimelineView {
  return { pxPerFrame: 2, scrollLeftPx: 0, viewportWidthPx: 1000, ...overrides };
}

describe("scale conversion", () => {
  it("converts between px/frame and px/second", () => {
    expect(pxPerSecond(view(), FPS_30)).toBe(60);
    expect(pxPerFrameFromPxPerSecond(60, FPS_30)).toBe(2);
  });

  it("round-trips at fractional frame rates", () => {
    const v = pxPerFrameFromPxPerSecond(100, FPS_29_97);
    expect(pxPerSecond({ ...view(), pxPerFrame: v }, FPS_29_97)).toBeCloseTo(100, 8);
  });
});

describe("frame <-> pixel mapping", () => {
  it("maps frames to screen positions", () => {
    expect(frameToX(view(), 0)).toBe(0);
    expect(frameToX(view(), 100)).toBe(200);
    expect(frameToX(view({ scrollLeftPx: 50 }), 100)).toBe(150);
  });

  it("maps screen positions back to frames", () => {
    expect(xToFrame(view(), 200)).toBe(100);
    expect(xToFrame(view({ scrollLeftPx: 50 }), 150)).toBe(100);
  });

  it("round-trips for any frame at any scale and scroll", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.double({ min: 0.05, max: 40, noNaN: true }),
        fc.integer({ min: 0, max: 100_000 }),
        (frame, pxPerFrame, scrollLeftPx) => {
          const v = view({ pxPerFrame, scrollLeftPx });
          expect(xToFrame(v, frameToX(v, frame))).toBe(frame);
        },
      ),
    );
  });

  it("keeps an unrounded frame for smooth drags", () => {
    expect(xToFrameExact(view(), 3)).toBe(1.5);
    expect(xToFrame(view(), 3)).toBe(2);
  });

  it("converts spans and deltas symmetrically", () => {
    expect(framesToWidth(view(), 30)).toBe(60);
    expect(widthToFrames(view(), 60)).toBe(30);
  });
});

describe("visible range and culling", () => {
  it("covers exactly what is on screen", () => {
    const { start, end } = visibleFrameRange(view({ scrollLeftPx: 200 }));
    expect(start).toBe(100);
    expect(end).toBe(600);
  });

  it("never returns a negative start", () => {
    expect(visibleFrameRange(view(), 500).start).toBe(0);
  });

  it("includes clips straddling either edge", () => {
    const v = view({ scrollLeftPx: 200 }); // frames 100..600
    expect(isVisible(v, 50, 100)).toBe(true); // ends at 150, inside
    expect(isVisible(v, 550, 100)).toBe(true); // starts at 550, inside
    expect(isVisible(v, 0, 100)).toBe(false); // ends at 100, exactly at start
    expect(isVisible(v, 700, 50)).toBe(false); // entirely right of view
  });

  it("agrees with an explicit intersection test", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 0, max: 4000 }),
        (startFrame, durationFrames, scrollLeftPx) => {
          const v = view({ scrollLeftPx });
          const { start, end } = visibleFrameRange(v);
          const expected = startFrame < end && startFrame + durationFrames > start;
          expect(isVisible(v, startFrame, durationFrames)).toBe(expected);
        },
      ),
    );
  });
});

describe("content width and scrolling", () => {
  it("derives width from where content ends, not a stored duration", () => {
    expect(contentWidthPx(view(), 1000)).toBe(2000 + TAIL_PAD_PX);
  });

  it("never reports less than a viewport", () => {
    expect(contentWidthPx(view(), 0)).toBe(1000);
  });

  it("shrinks when content is removed", () => {
    // The old model padded a duration that only ever grew, so deleting the
    // last clip left the timeline stretched.
    const wide = contentWidthPx(view(), 5000);
    const narrow = contentWidthPx(view(), 100);
    expect(narrow).toBeLessThan(wide);
  });

  it("clamps scroll into range", () => {
    const v = view({ scrollLeftPx: 99_999 });
    expect(clampScroll(v, 1000).scrollLeftPx).toBe(maxScrollLeftPx(v, 1000));
    expect(clampScroll(view({ scrollLeftPx: -50 }), 1000).scrollLeftPx).toBe(0);
  });

  it("returns the same object when nothing needs clamping", () => {
    const v = view({ scrollLeftPx: 100 });
    expect(clampScroll(v, 5000)).toBe(v);
  });
});

describe("cursor-anchored zoom", () => {
  it("keeps the frame under the cursor in place", () => {
    // This is the property that makes zooming usable.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        fc.integer({ min: 0, max: 5000 }),
        (anchorX, factor, scrollLeftPx) => {
          const before = view({ scrollLeftPx });
          const frameUnderCursor = xToFrameExact(before, anchorX);
          const after = zoomAt(before, anchorX, factor, FPS_30, 100_000);

          // Not meaningful when the zoom hit a limit and nothing moved.
          if (after.pxPerFrame === before.pxPerFrame) return;

          // Nor when holding the anchor would require scrolling past frame
          // zero: there is nothing before the start of the timeline to show,
          // so the view is pinned to the left edge instead. See the test below.
          const wanted = frameUnderCursor * after.pxPerFrame - anchorX;
          if (wanted < 0) {
            expect(after.scrollLeftPx).toBe(0);
            return;
          }

          expect(xToFrameExact(after, anchorX)).toBeCloseTo(frameUnderCursor, 4);
        },
      ),
    );
  });

  it("pins to the start rather than scrolling past frame zero", () => {
    // Zooming out near the beginning cannot keep the anchor fixed, because
    // that would mean showing negative time. Staying at frame zero is the
    // right answer; drifting into empty space to the left is not.
    const before = view({ scrollLeftPx: 0 });
    const after = zoomAt(before, 1, 0.2, FPS_30, 100_000);
    expect(after.scrollLeftPx).toBe(0);
    expect(after.pxPerFrame).toBeLessThan(before.pxPerFrame);
  });

  it("zooms in and out", () => {
    const v = view();
    expect(zoomAt(v, 0, 2, FPS_30, 100_000).pxPerFrame).toBe(4);
    expect(zoomAt(v, 0, 0.5, FPS_30, 100_000).pxPerFrame).toBe(1);
  });

  it("respects the zoom limits", () => {
    const fps = frameRateToNumber(FPS_30);
    let v = view();
    for (let i = 0; i < 100; i++) v = zoomAt(v, 500, 2, FPS_30, 100_000);
    expect(pxPerSecond(v, FPS_30)).toBeCloseTo(MAX_PX_PER_SECOND, 6);
    expect(v.pxPerFrame).toBeCloseTo(MAX_PX_PER_SECOND / fps, 6);

    for (let i = 0; i < 200; i++) v = zoomAt(v, 500, 0.5, FPS_30, 100_000);
    expect(pxPerSecond(v, FPS_30)).toBeCloseTo(MIN_PX_PER_SECOND, 6);
  });

  it("means the same thing at any frame rate", () => {
    // Limits are expressed per second so 24fps and 60fps material zoom to the
    // same visible duration, not the same pixels-per-frame.
    for (const rate of [FPS_24, FPS_30, FPS_60]) {
      let v = { ...view(), pxPerFrame: pxPerFrameFromPxPerSecond(60, rate) };
      for (let i = 0; i < 100; i++) v = zoomAt(v, 500, 2, rate, 100_000);
      expect(pxPerSecond(v, rate)).toBeCloseTo(MAX_PX_PER_SECOND, 6);
    }
  });

  it("returns the same view when already at a limit", () => {
    let v = view();
    for (let i = 0; i < 100; i++) v = zoomAt(v, 500, 2, FPS_30, 100_000);
    expect(zoomAt(v, 500, 2, FPS_30, 100_000)).toBe(v);
  });

  it("zooms about the viewport centre for keyboard zoom", () => {
    const v = view({ scrollLeftPx: 400 });
    const centreFrame = xToFrameExact(v, v.viewportWidthPx / 2);
    const zoomed = zoomCentered(v, 2, FPS_30, 100_000);
    expect(xToFrameExact(zoomed, zoomed.viewportWidthPx / 2)).toBeCloseTo(
      centreFrame,
      4,
    );
  });

  it("never produces a negative scroll offset", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (anchorX, factor) => {
          const result = zoomAt(view(), anchorX, factor, FPS_30, 10_000);
          expect(result.scrollLeftPx).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe("fit and zoom-to-range", () => {
  it("fits a range within the viewport", () => {
    const v = zoomToRange(view(), 0, 300, FPS_30);
    expect(framesToWidth(v, 300)).toBeLessThanOrEqual(view().viewportWidthPx);
  });

  it("scrolls so the range starts on screen", () => {
    const v = zoomToRange(view(), 1000, 1300, FPS_30);
    expect(frameToX(v, 1000)).toBeGreaterThanOrEqual(0);
    expect(frameToX(v, 1000)).toBeLessThan(100);
  });

  it("makes a short edit fill the window", () => {
    // The headline fix: a 20-second edit used to occupy ~6% of the panel.
    const twentySeconds = 20 * 30;
    const fitted = fitToWindow(view(), twentySeconds, FPS_30);
    const occupied = framesToWidth(fitted, twentySeconds) / fitted.viewportWidthPx;
    expect(occupied).toBeGreaterThan(0.9);
  });

  it("falls back to a sane scale for an empty timeline", () => {
    const fitted = fitToWindow(view(), 0, FPS_30);
    expect(fitted.scrollLeftPx).toBe(0);
    expect(pxPerSecond(fitted, FPS_30)).toBeGreaterThan(0);
    // Roughly a minute visible in a 1000px viewport.
    const visibleSeconds = fitted.viewportWidthPx / pxPerSecond(fitted, FPS_30);
    expect(visibleSeconds).toBeGreaterThan(30);
    expect(visibleSeconds).toBeLessThan(120);
  });

  it("clamps rather than exceeding the maximum zoom on a one-frame range", () => {
    const fitted = fitToWindow(view(), 1, FPS_30);
    expect(pxPerSecond(fitted, FPS_30)).toBeLessThanOrEqual(MAX_PX_PER_SECOND + 1e-6);
  });

  it("handles a project longer than the minimum zoom allows", () => {
    const tenHours = 10 * 3600 * 30;
    const fitted = fitToWindow(view(), tenHours, FPS_30);
    expect(pxPerSecond(fitted, FPS_30)).toBeGreaterThanOrEqual(
      MIN_PX_PER_SECOND - 1e-9,
    );
  });
});

describe("scrolling to a frame", () => {
  it("does nothing when the frame is comfortably visible", () => {
    const v = view();
    expect(scrollToFrame(v, 250, 10_000)).toBe(v);
  });

  it("scrolls left when the frame is behind the view", () => {
    const v = view({ scrollLeftPx: 1000 });
    const next = scrollToFrame(v, 100, 10_000);
    expect(frameToX(next, 100)).toBeGreaterThanOrEqual(0);
    expect(next.scrollLeftPx).toBeLessThan(v.scrollLeftPx);
  });

  it("scrolls right when the frame is past the view", () => {
    const v = view();
    const next = scrollToFrame(v, 900, 10_000);
    expect(frameToX(next, 900)).toBeLessThanOrEqual(v.viewportWidthPx);
  });

  it("centres a frame", () => {
    const next = centerOnFrame(view(), 1000, 10_000);
    expect(frameToX(next, 1000)).toBeCloseTo(500, 6);
  });

  it("clamps rather than scrolling past the content", () => {
    const next = centerOnFrame(view(), 10, 10_000);
    expect(next.scrollLeftPx).toBe(0);
  });
});

describe("ruler ticks", () => {
  it("only generates ticks for the visible range", () => {
    // Cost must not grow with project length; the old ruler walked the whole
    // project duration on every render.
    const v = view({ scrollLeftPx: 0 });
    const ticks = rulerTicks(v, FPS_30);
    expect(ticks.length).toBeLessThan(40);
    expect(ticks[0].frame).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1].frame).toBeLessThanOrEqual(visibleFrameRange(v).end);
  });

  it("keeps labels readable at every zoom", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.02, max: 20, noNaN: true }), (pxPerFrame) => {
        const ticks = rulerTicks(view({ pxPerFrame }), FPS_30, 90);
        for (let i = 1; i < ticks.length; i++) {
          expect(ticks[i].x - ticks[i - 1].x).toBeGreaterThanOrEqual(89.99);
        }
      }),
    );
  });

  it("steps in whole frames when zoomed right in", () => {
    // At 120px per frame, consecutive ticks must be one frame apart.
    const ticks = rulerTicks(view({ pxPerFrame: 120 }), FPS_30, 90);
    expect(ticks[1].frame - ticks[0].frame).toBe(1);
  });

  it("steps in large second multiples when zoomed right out", () => {
    const ticks = rulerTicks(view({ pxPerFrame: 0.02 }), FPS_30, 90);
    const stepFrames = ticks[1].frame - ticks[0].frame;
    expect(stepFrames / 30).toBeGreaterThanOrEqual(300);
  });

  it("never emits a negative frame", () => {
    for (const scrollLeftPx of [0, 5, 100]) {
      for (const tick of rulerTicks(view({ scrollLeftPx }), FPS_30)) {
        expect(tick.frame).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("marks every fifth tick as major", () => {
    const ticks = rulerTicks(view(), FPS_30);
    expect(ticks.some((t) => t.major)).toBe(true);
    expect(ticks.some((t) => !t.major)).toBe(true);
  });
});

describe("snapping", () => {
  it("snaps to a nearby candidate", () => {
    // 8px threshold at 2px/frame is 4 frames.
    const result = snapFrame(view(), 102, [100, 500]);
    expect(result.frame).toBe(100);
    expect(result.snapped).toBe(100);
  });

  it("leaves the frame alone when nothing is close", () => {
    const result = snapFrame(view(), 300, [100, 500]);
    expect(result.frame).toBe(300);
    expect(result.snapped).toBeNull();
  });

  it("picks the nearest of several candidates", () => {
    expect(snapFrame(view(), 101, [100, 103]).frame).toBe(100);
    expect(snapFrame(view(), 102.6, [100, 103]).frame).toBe(103);
  });

  it("engages over the same visual distance at any zoom", () => {
    // The threshold is in pixels, so a snap that engages when the target looks
    // close keeps doing so whether you are zoomed in or out.
    const zoomedIn = view({ pxPerFrame: 20 });
    const zoomedOut = view({ pxPerFrame: 0.5 });

    // 4px away in both cases.
    expect(snapFrame(zoomedIn, 100 + 4 / 20, [100]).snapped).toBe(100);
    expect(snapFrame(zoomedOut, 100 + 4 / 0.5, [100]).snapped).toBe(100);

    // 12px away in both cases — beyond the 8px threshold.
    expect(snapFrame(zoomedIn, 100 + 12 / 20, [100]).snapped).toBeNull();
    expect(snapFrame(zoomedOut, 100 + 12 / 0.5, [100]).snapped).toBeNull();
  });

  it("handles an empty candidate list", () => {
    expect(snapFrame(view(), 42, []).frame).toBe(42);
  });
});
