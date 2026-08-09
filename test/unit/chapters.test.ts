import { describe, it, expect } from "vitest";
import { create } from "mutative";
import {
  toYouTubeChapters,
  toVttChapters,
  toMarkerList,
  chapterTimestamp,
  vttTimestamp,
} from "@/model/chapters";
import { createEmptyDoc, type ProjectDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30, FPS_29_97 } from "@/lib/timecode";

/**
 * Markers leaving the app.
 *
 * The formats are strict in ways that fail silently: YouTube ignores a whole
 * chapter list whose first entry is not at 0:00, and WebVTT rejects a
 * timestamp without its hours field. Both are the sort of thing you discover
 * from the far end, days later, so they are pinned here.
 */

function docWithMarkers(
  frames: number[],
  names: string[] = [],
  rate = FPS_30,
): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    d.sequence.frameRate = rate;
    edits.upsertAsset(d, {
      id: "a",
      name: "a.mp4",
      kind: "video",
      size: 1,
      durationSec: 600,
      hasAudio: false,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 9000, {
      startFrame: 0,
      mode: "overwrite",
    });
    frames.forEach((frame, index) => {
      edits.addMarker(d, frame, names[index] ?? "");
    });
  });
}

describe("timestamps", () => {
  it("drops the hours field under an hour, as YouTube expects", () => {
    expect(chapterTimestamp(0)).toBe("0:00");
    expect(chapterTimestamp(65)).toBe("1:05");
    expect(chapterTimestamp(599)).toBe("9:59");
  });

  it("keeps it past an hour", () => {
    expect(chapterTimestamp(3600)).toBe("1:00:00");
    expect(chapterTimestamp(3725)).toBe("1:02:05");
  });

  it("always writes hours in WebVTT, which requires them", () => {
    expect(vttTimestamp(0)).toBe("00:00:00.000");
    expect(vttTimestamp(65.5)).toBe("00:01:05.500");
    expect(vttTimestamp(3725.25)).toBe("01:02:05.250");
  });

  it("never emits a negative timestamp", () => {
    expect(vttTimestamp(-1)).toBe("00:00:00.000");
  });
});

describe("YouTube chapters", () => {
  it("lists markers in time order", () => {
    const doc = docWithMarkers([300, 60, 900], ["Third", "First", "Fourth"]);
    // Markers were added out of order; the output must not be.
    expect(toYouTubeChapters(doc)).toBe(
      ["0:00 Start", "0:02 First", "0:10 Third", "0:30 Fourth"].join("\n"),
    );
  });

  it("adds a 0:00 entry when the first marker is later", () => {
    // Without one, YouTube ignores the entire list rather than most of it.
    const doc = docWithMarkers([300], ["Intro over"]);
    expect(toYouTubeChapters(doc).split("\n")[0]).toBe("0:00 Start");
  });

  it("does not add one when a marker is already at zero", () => {
    const doc = docWithMarkers([0, 300], ["Cold open", "Titles"]);
    const lines = toYouTubeChapters(doc).split("\n");
    expect(lines[0]).toBe("0:00 Cold open");
    expect(lines).toHaveLength(2);
  });

  it("names an unnamed marker rather than emitting a bare timestamp", () => {
    const doc = docWithMarkers([0, 300]);
    expect(toYouTubeChapters(doc)).toBe("0:00 Chapter\n0:10 Chapter");
  });

  it("is empty when there are no markers", () => {
    expect(toYouTubeChapters(createEmptyDoc())).toBe("");
  });

  it("uses the sequence's real frame rate", () => {
    // At 29.97, frame 1800 is 60.06 seconds — a minute and no more.
    const doc = docWithMarkers([1800], ["A minute in"], FPS_29_97);
    expect(toYouTubeChapters(doc)).toContain("1:00 A minute in");
  });
});

describe("WebVTT chapters", () => {
  it("starts with the WEBVTT header", () => {
    const doc = docWithMarkers([0, 300]);
    expect(toVttChapters(doc).startsWith("WEBVTT\n")).toBe(true);
  });

  it("runs each cue to the next marker", () => {
    const doc = docWithMarkers([0, 300], ["One", "Two"]);
    expect(toVttChapters(doc)).toContain("00:00:00.000 --> 00:00:10.000\nOne");
  });

  it("runs the last cue to the end of the content", () => {
    // A cue needs an end time and a marker is a point; the content's end is
    // the only defensible choice.
    const doc = docWithMarkers([300], ["Only"]);
    // 9000 frames at 30fps is 300 seconds.
    expect(toVttChapters(doc)).toContain("--> 00:05:00.000");
  });

  it("still produces a valid file with no markers", () => {
    expect(toVttChapters(createEmptyDoc())).toBe("WEBVTT\n");
  });

  it("gives an unnamed marker a numbered title", () => {
    const doc = docWithMarkers([0, 300]);
    expect(toVttChapters(doc)).toContain("Chapter 1");
    expect(toVttChapters(doc)).toContain("Chapter 2");
  });

  it("never emits a cue that ends before it starts", () => {
    // A marker past the end of the content would otherwise invert.
    const doc = create(docWithMarkers([300]), (d) => {
      edits.addMarker(d, 99_999, "Way past the end");
    });
    for (const line of toVttChapters(doc).split("\n")) {
      if (!line.includes("-->")) continue;
      const [start, end] = line.split(" --> ");
      expect(end.localeCompare(start), line).toBeGreaterThan(0);
    }
  });
});

describe("plain list", () => {
  it("is tab separated, with the note when there is one", () => {
    const doc = create(docWithMarkers([0], ["Take 3"]), (d) => {
      d.markers[0].note = "watch the boom";
    });
    expect(toMarkerList(doc)).toBe("0:00\tTake 3\twatch the boom");
  });
});
