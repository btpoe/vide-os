import { describe, it, expect, beforeEach } from "vitest";
import { TimelineClock, SHUTTLE_RATES } from "@/playback/clock";
import { FPS_30, FPS_29_97, framesToSeconds } from "@/lib/timecode";

/**
 * A hand-driven stand-in for AudioContext.currentTime, so these tests are
 * deterministic rather than depending on wall-clock timing.
 */
class FakeContext {
  currentTime = 0;
  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

let context: FakeContext;
function makeClock(rate = FPS_30) {
  context = new FakeContext();
  return new TimelineClock({
    getContext: () => context,
    frameRate: () => rate,
  });
}

describe("paused state", () => {
  it("starts at zero and stays there", () => {
    const clock = makeClock();
    expect(clock.nowSec()).toBe(0);
    expect(clock.nowFrame()).toBe(0);

    // Time passing must not move a paused playhead.
    context.advance(5);
    expect(clock.nowFrame()).toBe(0);
    expect(clock.isPlaying()).toBe(false);
  });

  it("holds position after pausing", () => {
    const clock = makeClock();
    clock.play();
    context.advance(2);
    clock.pause();

    const frame = clock.nowFrame();
    expect(frame).toBe(60);
    context.advance(10);
    expect(clock.nowFrame()).toBe(frame);
  });
});

describe("playback", () => {
  it("advances in step with context time", () => {
    const clock = makeClock();
    clock.play();

    context.advance(1);
    expect(clock.nowFrame()).toBe(30);
    context.advance(1);
    expect(clock.nowFrame()).toBe(60);
  });

  it("does not drift over a long run", () => {
    // The old clock accumulated rAF deltas, which drift against the audio it
    // was supposedly following. Ten minutes must land exactly.
    const clock = makeClock();
    clock.play();
    for (let i = 0; i < 600; i++) context.advance(1);
    expect(clock.nowFrame()).toBe(600 * 30);
  });

  it("is exact at NTSC rates", () => {
    const clock = makeClock(FPS_29_97);
    clock.play();
    context.advance(3600); // one hour
    // 107892 frames is exactly one hour at 30000/1001.
    expect(clock.nowFrame()).toBe(107892);
  });

  it("scales with playback rate", () => {
    const clock = makeClock();
    clock.play(2);
    context.advance(1);
    expect(clock.nowFrame()).toBe(60);
  });

  it("re-anchors on a rate change rather than rescaling elapsed time", () => {
    const clock = makeClock();
    clock.play(1);
    context.advance(2); // now at frame 60
    clock.play(2);
    context.advance(1); // +2s of timeline
    expect(clock.nowFrame()).toBe(60 + 60);
  });

  it("plays backwards at a negative rate", () => {
    const clock = makeClock();
    clock.seekFrame(300);
    clock.play(-1);
    context.advance(2);
    expect(clock.nowFrame()).toBe(300 - 60);
  });

  it("never reports a negative frame", () => {
    const clock = makeClock();
    clock.seekFrame(30);
    clock.play(-1);
    context.advance(10);
    expect(clock.nowFrame()).toBe(0);
  });
});

describe("seeking", () => {
  it("jumps to a frame", () => {
    const clock = makeClock();
    clock.seekFrame(123);
    expect(clock.nowFrame()).toBe(123);
  });

  it("keeps playing across a seek", () => {
    const clock = makeClock();
    clock.play();
    context.advance(1);
    clock.seekFrame(0);
    expect(clock.isPlaying()).toBe(true);
    context.advance(1);
    expect(clock.nowFrame()).toBe(30);
  });

  it("clamps a negative seek", () => {
    const clock = makeClock();
    clock.seekFrame(-100);
    expect(clock.nowFrame()).toBe(0);
  });

  it("round-trips frames exactly", () => {
    const clock = makeClock(FPS_29_97);
    for (const frame of [0, 1, 29, 30, 1799, 107892]) {
      clock.seekFrame(frame);
      expect(clock.nowFrame()).toBe(frame);
    }
  });
});

describe("frame stepping", () => {
  it("moves exactly one frame", () => {
    const clock = makeClock();
    clock.seekFrame(100);
    clock.stepFrames(1);
    expect(clock.nowFrame()).toBe(101);
    clock.stepFrames(-1);
    expect(clock.nowFrame()).toBe(100);
  });

  it("does not accumulate error over many steps", () => {
    // The old stepper added a float 1/fps to a float position, so repeated
    // steps drifted off the frame grid.
    const clock = makeClock(FPS_29_97);
    clock.seekFrame(0);
    for (let i = 0; i < 1000; i++) clock.stepFrames(1);
    expect(clock.nowFrame()).toBe(1000);
  });

  it("pauses when stepping", () => {
    const clock = makeClock();
    clock.play();
    clock.stepFrames(1);
    expect(clock.isPlaying()).toBe(false);
  });

  it("stops at zero", () => {
    const clock = makeClock();
    clock.seekFrame(2);
    clock.stepFrames(-10);
    expect(clock.nowFrame()).toBe(0);
  });
});

describe("shuttle", () => {
  it("steps up through the rates", () => {
    const clock = makeClock();
    clock.shuttle(1);
    expect(clock.playbackRate()).toBe(0.5);
    clock.shuttle(1);
    expect(clock.playbackRate()).toBe(1);
    clock.shuttle(1);
    expect(clock.playbackRate()).toBe(2);
  });

  it("steps down into reverse", () => {
    const clock = makeClock();
    clock.shuttle(-1);
    expect(clock.playbackRate()).toBe(-0.5);
    expect(clock.isPlaying()).toBe(true);
  });

  it("pauses when it reaches zero", () => {
    const clock = makeClock();
    clock.play(0.5);
    clock.shuttle(-1);
    expect(clock.isPlaying()).toBe(false);
  });

  it("clamps at the ends", () => {
    const clock = makeClock();
    for (let i = 0; i < 20; i++) clock.shuttle(1);
    expect(clock.playbackRate()).toBe(SHUTTLE_RATES[SHUTTLE_RATES.length - 1]);
    for (let i = 0; i < 40; i++) clock.shuttle(-1);
    expect(clock.playbackRate()).toBe(SHUTTLE_RATES[0]);
  });

  it("keeps position continuous across a shuttle change", () => {
    const clock = makeClock();
    clock.play(1);
    context.advance(2);
    const before = clock.nowFrame();
    clock.shuttle(1);
    expect(clock.nowFrame()).toBe(before);
  });
});

describe("no audio context", () => {
  it("still reports a stable position", () => {
    // The clock must not fall over before the user has gestured and the
    // AudioContext exists.
    const clock = new TimelineClock({
      getContext: () => null,
      frameRate: () => FPS_30,
    });
    clock.seekFrame(42);
    clock.play();
    expect(clock.nowFrame()).toBe(42);
    expect(Number.isFinite(clock.nowSec())).toBe(true);
  });
});

describe("frame quantisation", () => {
  beforeEach(() => {
    context = new FakeContext();
  });

  it("reports whole frames while seconds run continuously", () => {
    const clock = makeClock();
    clock.play();
    // Half a frame in.
    context.advance(framesToSeconds(1, FPS_30) / 2);
    expect(clock.nowSec()).toBeGreaterThan(0);
    // Rounds to the nearest frame, so the display never sits between frames.
    expect(Number.isInteger(clock.nowFrame())).toBe(true);
  });
});
