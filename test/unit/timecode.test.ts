import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  FPS_24,
  FPS_23_976,
  FPS_25,
  FPS_29_97,
  FPS_30,
  FPS_59_94,
  FPS_60,
  frameRateToNumber,
  frameRateFromNumber,
  framesToSeconds,
  secondsToFrames,
  frameDurationSeconds,
  isDropFrame,
  framesToTimecode,
  timecodeToFrames,
  formatDurationSeconds,
} from "@/lib/timecode";

describe("frame rates", () => {
  it("keeps NTSC rates exact", () => {
    expect(frameRateToNumber(FPS_29_97)).toBeCloseTo(29.97, 4);
    expect(frameRateToNumber(FPS_23_976)).toBeCloseTo(23.976, 4);
  });

  it("recovers NTSC rates from their rounded decimals", () => {
    // Old projects stored fps as a number; 29.97 must come back as 30000/1001,
    // not as 2997/100, or long timelines drift.
    expect(frameRateFromNumber(29.97)).toEqual(FPS_29_97);
    expect(frameRateFromNumber(23.976)).toEqual(FPS_23_976);
    expect(frameRateFromNumber(59.94)).toEqual(FPS_59_94);
    expect(frameRateFromNumber(30)).toEqual(FPS_30);
    expect(frameRateFromNumber(25)).toEqual(FPS_25);
  });

  it("keeps unknown integer rates exact", () => {
    expect(frameRateFromNumber(48)).toEqual({ num: 48, den: 1 });
  });

  it("identifies drop-frame rates", () => {
    expect(isDropFrame(FPS_29_97)).toBe(true);
    expect(isDropFrame(FPS_59_94)).toBe(true);
    expect(isDropFrame(FPS_30)).toBe(false);
    expect(isDropFrame(FPS_23_976)).toBe(false); // 24000/1001 is non-drop
  });
});

describe("frame <-> second conversion", () => {
  it("round-trips exactly at integer rates", () => {
    for (const frames of [0, 1, 29, 30, 31, 1799, 108000]) {
      expect(secondsToFrames(framesToSeconds(frames, FPS_30), FPS_30)).toBe(frames);
    }
  });

  it("round-trips exactly at NTSC rates", () => {
    for (const frames of [0, 1, 29, 30, 1800, 107892]) {
      expect(secondsToFrames(framesToSeconds(frames, FPS_29_97), FPS_29_97)).toBe(
        frames,
      );
    }
  });

  it("round-trips any frame count at any preset rate", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.constantFrom(FPS_23_976, FPS_24, FPS_25, FPS_29_97, FPS_30, FPS_60),
        (frames, rate) => {
          expect(secondsToFrames(framesToSeconds(frames, rate), rate)).toBe(frames);
        },
      ),
    );
  });

  it("rounds to the nearest frame rather than truncating", () => {
    // 1.9999s at 30fps is frame 60, not 59 — truncation here is what makes a
    // playhead land one frame short of where it was dragged.
    expect(secondsToFrames(1.9999, FPS_30)).toBe(60);
    expect(secondsToFrames(2.0001, FPS_30)).toBe(60);
  });

  it("reports frame duration", () => {
    expect(frameDurationSeconds(FPS_30)).toBeCloseTo(1 / 30, 10);
    expect(frameDurationSeconds(FPS_29_97)).toBeCloseTo(1001 / 30000, 10);
  });
});

describe("non-drop timecode", () => {
  it("formats known frame counts", () => {
    expect(framesToTimecode(0, FPS_30)).toBe("00:00:00:00");
    expect(framesToTimecode(29, FPS_30)).toBe("00:00:00:29");
    expect(framesToTimecode(30, FPS_30)).toBe("00:00:01:00");
    expect(framesToTimecode(1800, FPS_30)).toBe("00:01:00:00");
    expect(framesToTimecode(108000, FPS_30)).toBe("01:00:00:00");
  });

  it("formats negative frame counts", () => {
    expect(framesToTimecode(-30, FPS_30)).toBe("-00:00:01:00");
  });

  it("round-trips", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400_000 }),
        fc.constantFrom(FPS_24, FPS_25, FPS_30, FPS_60),
        (frames, rate) => {
          const tc = framesToTimecode(frames, rate);
          expect(timecodeToFrames(tc, rate)).toBe(frames);
        },
      ),
    );
  });
});

describe("drop-frame timecode", () => {
  it("uses a semicolon separator", () => {
    expect(framesToTimecode(0, FPS_29_97)).toBe("00:00:00;00");
  });

  it("skips frame numbers 0 and 1 at the top of most minutes", () => {
    // Frame 1798 is the last of minute 0; the next frame is numbered ;02.
    expect(framesToTimecode(1798, FPS_29_97)).toBe("00:00:59;28");
    expect(framesToTimecode(1799, FPS_29_97)).toBe("00:00:59;29");
    expect(framesToTimecode(1800, FPS_29_97)).toBe("00:01:00;02");
  });

  it("does not skip at every tenth minute", () => {
    // 10 minutes = 17982 frames; minute 10 starts at ;00 with no drop.
    expect(framesToTimecode(17982, FPS_29_97)).toBe("00:10:00;00");
  });

  it("keeps an hour of timecode aligned with an hour of wall clock", () => {
    // The point of drop-frame: at 107892 frames the timecode reads one hour,
    // and one hour is very nearly what has actually elapsed. The residual is
    // ~3.6ms per hour, which is the known limit of the scheme, not an error.
    expect(framesToTimecode(107892, FPS_29_97)).toBe("01:00:00;00");
    expect(framesToSeconds(107892, FPS_29_97)).toBeCloseTo(3600, 2);

    // Non-drop numbering would have drifted 3.6 *seconds* over the same hour.
    expect(framesToTimecode(107892, FPS_30)).toBe("00:59:56:12");
  });

  it("round-trips", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400_000 }),
        fc.constantFrom(FPS_29_97, FPS_59_94),
        (frames, rate) => {
          const tc = framesToTimecode(frames, rate);
          expect(timecodeToFrames(tc, rate)).toBe(frames);
        },
      ),
    );
  });
});

describe("timecode parsing", () => {
  it("accepts short forms", () => {
    expect(timecodeToFrames("01:00", FPS_30)).toBe(30); // SS:FF
    expect(timecodeToFrames("00:01:00", FPS_30)).toBe(30); // MM:SS:FF
    expect(timecodeToFrames("00:00:01:00", FPS_30)).toBe(30);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "1", "1:2:3:4:5", "00:00:00:", "::", "-"]) {
      expect(timecodeToFrames(bad, FPS_30)).toBeNull();
    }
  });

  it("rejects out-of-range components", () => {
    expect(timecodeToFrames("00:00:00:30", FPS_30)).toBeNull(); // frame >= fps
    expect(timecodeToFrames("00:00:60:00", FPS_30)).toBeNull();
    expect(timecodeToFrames("00:60:00:00", FPS_30)).toBeNull();
  });
});

describe("duration formatting", () => {
  it("omits hours below an hour", () => {
    expect(formatDurationSeconds(0)).toBe("0:00");
    expect(formatDurationSeconds(9)).toBe("0:09");
    expect(formatDurationSeconds(75)).toBe("1:15");
    expect(formatDurationSeconds(3599)).toBe("59:59");
  });

  it("includes hours above an hour", () => {
    expect(formatDurationSeconds(3600)).toBe("1:00:00");
    expect(formatDurationSeconds(3725)).toBe("1:02:05");
  });

  it("survives junk input", () => {
    expect(formatDurationSeconds(NaN)).toBe("0:00");
    expect(formatDurationSeconds(Infinity)).toBe("0:00");
    expect(formatDurationSeconds(-5)).toBe("0:00");
  });
});
