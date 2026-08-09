import { describe, it, expect } from "vitest";
import {
  parseSubtitles,
  parseTimestamp,
  formatTimestamp,
  toSrt,
  toVtt,
  cueAt,
  type SubtitleCue,
} from "@/model/subtitles";
import { FPS_30, FPS_29_97, framesToSeconds } from "@/lib/timecode";

/**
 * Reading and writing subtitles.
 *
 * Every assertion here is about a real file in the wild rather than a
 * hypothetical: SRT uses a comma before the milliseconds and VTT a dot, VTT
 * may omit the hours, files arrive CRLF with a BOM and cue settings after the
 * timestamps, and plenty end without a trailing newline. Accepting only the
 * tidy case would silently reject about half of what anyone has on disk.
 */

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:04,000 --> 00:00:06,000
General Kenobi.
You are a bold one.
`;

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.500 line:90% align:center
Hello there.

2
00:00:04.000 --> 00:00:06.000
General Kenobi.
`;

describe("timestamps", () => {
  it("reads SRT's comma and VTT's dot alike", () => {
    expect(parseTimestamp("00:00:01,500")).toBeCloseTo(1.5, 6);
    expect(parseTimestamp("00:00:01.500")).toBeCloseTo(1.5, 6);
  });

  it("accepts VTT's optional hours field", () => {
    expect(parseTimestamp("01:30.250")).toBeCloseTo(90.25, 6);
  });

  it("treats the fraction as a decimal, not a count", () => {
    // "5" is half a second, not five milliseconds.
    expect(parseTimestamp("00:00:00.5")).toBeCloseTo(0.5, 6);
    expect(parseTimestamp("00:00:00.05")).toBeCloseTo(0.05, 6);
  });

  it("handles hours past 99", () => {
    expect(parseTimestamp("100:00:00.000")).toBeCloseTo(360_000, 6);
  });

  it("rejects nonsense rather than guessing", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("soon")).toBeNull();
    expect(parseTimestamp("00:00:01")).toBeNull();
  });

  it("writes each dialect's separator", () => {
    expect(formatTimestamp(3661.5, ",")).toBe("01:01:01,500");
    expect(formatTimestamp(3661.5, ".")).toBe("01:01:01.500");
  });

  it("always writes the hours field, which SRT requires", () => {
    expect(formatTimestamp(1.25, ",")).toBe("00:00:01,250");
  });
});

describe("parsing", () => {
  it("reads a plain SRT file", () => {
    const { cues, skipped } = parseSubtitles(SRT, FPS_30);
    expect(skipped).toBe(0);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Hello there.");
    expect(cues[0].startFrame).toBe(30);
    expect(cues[0].endFrame).toBe(105);
  });

  it("keeps line breaks inside a cue", () => {
    const { cues } = parseSubtitles(SRT, FPS_30);
    expect(cues[1].text).toBe("General Kenobi.\nYou are a bold one.");
  });

  it("reads a VTT file, header and all", () => {
    const { cues, skipped } = parseSubtitles(VTT, FPS_30);
    expect(skipped).toBe(0);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Hello there.");
  });

  it("ignores VTT cue settings after the timestamps", () => {
    // `line:90% align:center` is positioning, not dialogue.
    const { cues } = parseSubtitles(VTT, FPS_30);
    expect(cues[0].text).not.toContain("align");
  });

  it("survives CRLF line endings", () => {
    const { cues, skipped } = parseSubtitles(SRT.replace(/\n/g, "\r\n"), FPS_30);
    expect(skipped).toBe(0);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Hello there.");
  });

  it("survives a UTF-8 BOM", () => {
    const { cues } = parseSubtitles(`\uFEFF${SRT}`, FPS_30);
    expect(cues).toHaveLength(2);
  });

  it("reads a file with no trailing newline", () => {
    const { cues } = parseSubtitles(SRT.trimEnd(), FPS_30);
    expect(cues).toHaveLength(2);
  });

  it("copes with a missing cue number", () => {
    // The index is optional in VTT and routinely absent.
    const text = "00:00:01.000 --> 00:00:02.000\nNo number here.";
    const { cues, skipped } = parseSubtitles(text, FPS_30);
    expect(skipped).toBe(0);
    expect(cues[0].text).toBe("No number here.");
  });

  it("strips inline markup rather than drawing it", () => {
    const text = "1\n00:00:01,000 --> 00:00:02,000\n<i>Whispered.</i>";
    expect(parseSubtitles(text, FPS_30).cues[0].text).toBe("Whispered.");
  });

  it("counts blocks it could not read instead of dropping them silently", () => {
    const text = `1
not a timestamp
Some text.

2
00:00:01,000 --> 00:00:02,000
Fine.`;
    const { cues, skipped } = parseSubtitles(text, FPS_30);
    expect(cues).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("gives a zero-length cue at least one frame", () => {
    // Files with identical start and end timestamps exist, and a cue that is
    // never on screen looks like a parser bug from the outside.
    const text = "1\n00:00:01,000 --> 00:00:01,000\nBlink.";
    const [cue] = parseSubtitles(text, FPS_30).cues;
    expect(cue.endFrame).toBeGreaterThan(cue.startFrame);
  });

  it("sorts cues by time even when the file does not", () => {
    const text = `1
00:00:05,000 --> 00:00:06,000
Second.

2
00:00:01,000 --> 00:00:02,000
First.`;
    expect(parseSubtitles(text, FPS_30).cues.map((c) => c.text)).toEqual([
      "First.",
      "Second.",
    ]);
  });

  it("is empty for an empty file", () => {
    expect(parseSubtitles("", FPS_30).cues).toEqual([]);
    expect(parseSubtitles("WEBVTT\n", FPS_30).cues).toEqual([]);
  });

  it("uses the sequence's frame rate", () => {
    const text = "1\n00:00:01,000 --> 00:00:02,000\nOne second.";
    const { cues } = parseSubtitles(text, FPS_29_97);
    // One second at 30000/1001 is 29.97 frames, rounded.
    expect(cues[0].startFrame).toBe(30);
  });
});

describe("writing", () => {
  const cues: SubtitleCue[] = [
    { id: "a", startFrame: 30, endFrame: 105, text: "Hello there." },
    { id: "b", startFrame: 120, endFrame: 180, text: "General Kenobi." },
  ];

  it("round-trips through SRT", () => {
    const written = toSrt(cues, FPS_30);
    const { cues: read } = parseSubtitles(written, FPS_30);

    expect(read.map((c) => [c.startFrame, c.endFrame, c.text])).toEqual(
      cues.map((c) => [c.startFrame, c.endFrame, c.text]),
    );
  });

  it("round-trips through VTT", () => {
    const written = toVtt(cues, FPS_30);
    const { cues: read } = parseSubtitles(written, FPS_30);
    expect(read.map((c) => c.text)).toEqual(cues.map((c) => c.text));
  });

  it("numbers cues from one", () => {
    expect(toSrt(cues, FPS_30).startsWith("1\n")).toBe(true);
  });

  it("ends with a newline, which some players need to see the last cue", () => {
    expect(toSrt(cues, FPS_30).endsWith("\n")).toBe(true);
    expect(toVtt(cues, FPS_30).endsWith("\n")).toBe(true);
  });

  it("writes a valid VTT file with no cues", () => {
    expect(toVtt([], FPS_30)).toBe("WEBVTT\n");
  });

  it("sorts on the way out", () => {
    const reversed = [...cues].reverse();
    expect(toSrt(reversed, FPS_30)).toBe(toSrt(cues, FPS_30));
  });

  it("keeps multi-line text intact through a round trip", () => {
    const multi: SubtitleCue[] = [
      { id: "a", startFrame: 0, endFrame: 30, text: "Line one\nLine two" },
    ];
    const read = parseSubtitles(toSrt(multi, FPS_30), FPS_30).cues;
    expect(read[0].text).toBe("Line one\nLine two");
  });

  it("preserves sub-frame-accurate timing to the millisecond", () => {
    const cue: SubtitleCue[] = [{ id: "a", startFrame: 7, endFrame: 8, text: "x" }];
    const written = toSrt(cue, FPS_30);
    expect(written).toContain(formatTimestamp(framesToSeconds(7, FPS_30), ","));
  });
});

describe("finding the cue on screen", () => {
  const cues: SubtitleCue[] = [
    { id: "a", startFrame: 0, endFrame: 30, text: "First" },
    { id: "b", startFrame: 60, endFrame: 90, text: "Second" },
  ];

  it("finds the covering cue", () => {
    expect(cueAt(cues, 15)?.text).toBe("First");
    expect(cueAt(cues, 75)?.text).toBe("Second");
  });

  it("treats the end frame as exclusive, like every other span", () => {
    expect(cueAt(cues, 29)?.text).toBe("First");
    expect(cueAt(cues, 30)).toBeNull();
  });

  it("finds nothing between cues", () => {
    expect(cueAt(cues, 45)).toBeNull();
  });

  it("shows the later cue where two overlap", () => {
    const overlapping: SubtitleCue[] = [
      { id: "a", startFrame: 0, endFrame: 60, text: "Under" },
      { id: "b", startFrame: 30, endFrame: 90, text: "Over" },
    ];
    expect(cueAt(overlapping, 45)?.text).toBe("Over");
  });
});
