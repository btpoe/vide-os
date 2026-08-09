import { describe, it, expect } from "vitest";
import { create } from "mutative";
import * as edits from "@/model/edits";
import { createEmptyDoc, clipEndFrame, type ProjectDoc, type Track } from "@/model/doc";
import { assertDocValid } from "@/model/invariants";
import { FPS_30 } from "@/lib/timecode";

/**
 * Insert and overwrite, and the edit built on them.
 *
 * The distinction is the oldest one in editing and the easiest to get subtly
 * wrong: an overwrite replaces what it lands on and the sequence keeps its
 * length; an insert pushes everything rightward and it gets longer. The
 * interesting case is a clip straddling the insertion point, which has to be
 * split rather than half-moved.
 */

const SOURCE_FRAMES = 600;

function threeClips(): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    d.sequence.frameRate = FPS_30;
    edits.upsertAsset(d, {
      id: "a",
      name: "a.mp4",
      kind: "video",
      size: 1,
      durationSec: SOURCE_FRAMES / 30,
      hasAudio: false,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    for (let i = 0; i < 3; i++) {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: i * 30,
        mode: "overwrite",
        inPointFrames: 100,
      });
    }
  });
}

function videoTrack(doc: ProjectDoc): Track {
  return doc.tracks.find((t) => t.kind === "video")!;
}

function layout(doc: ProjectDoc): [number, number][] {
  return videoTrack(doc).clips.map((c) => [c.startFrame, c.durationFrames]);
}

function edit(doc: ProjectDoc, recipe: (d: ProjectDoc) => void): ProjectDoc {
  const next = create(doc, recipe);
  assertDocValid(next);
  return next;
}

describe("insert mode", () => {
  it("pushes everything from the insertion point rightward", () => {
    const base = threeClips();
    const track = videoTrack(base);

    const doc = edit(base, (d) => {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 10, {
        startFrame: 30,
        mode: "insert",
      });
    });

    expect(layout(doc)).toEqual([
      [0, 30],
      [30, 10],
      [40, 30],
      [70, 30],
    ]);
  });

  it("splits a clip it lands in the middle of", () => {
    // Half a clip moving while the other half stays would silently cut it.
    const base = threeClips();
    const track = videoTrack(base);

    const doc = edit(base, (d) => {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 10, {
        startFrame: 45,
        mode: "insert",
      });
    });

    expect(layout(doc)).toEqual([
      [0, 30],
      [30, 15],
      [45, 10],
      [55, 15],
      [70, 30],
    ]);
  });

  it("keeps the split halves continuous in the source", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 10, {
        startFrame: 45,
        mode: "insert",
      });
    });

    const clips = videoTrack(doc).clips;
    const before = clips[1];
    const after = clips[3];
    // The second half resumes where the first left off, so the cut is
    // invisible apart from what was inserted between them.
    expect(after.inPointFrames).toBe(before.inPointFrames + before.durationFrames);
  });

  it("makes the sequence longer by exactly what was inserted", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const before = clipEndFrame(videoTrack(base).clips[2]);

    const doc = edit(base, (d) => {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 25, {
        startFrame: 10,
        mode: "insert",
      });
    });

    const clips = videoTrack(doc).clips;
    expect(clipEndFrame(clips[clips.length - 1])).toBe(before + 25);
  });

  it("appends cleanly past the end", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 20, {
        startFrame: 200,
        mode: "insert",
      });
    });

    expect(layout(doc)).toEqual([
      [0, 30],
      [30, 30],
      [60, 30],
      [200, 20],
    ]);
  });
});

describe("overwrite mode", () => {
  it("replaces what it lands on without moving anything", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const before = clipEndFrame(videoTrack(base).clips[2]);

    const doc = edit(base, (d) => {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: 30,
        mode: "overwrite",
      });
    });

    expect(layout(doc)).toEqual([
      [0, 30],
      [30, 30],
      [60, 30],
    ]);
    const clips = videoTrack(doc).clips;
    expect(clipEndFrame(clips[clips.length - 1])).toBe(before);
  });
});

describe("three-point edit", () => {
  it("takes its length from the source range", () => {
    // The fourth point is implied — that is the entire idea.
    const base = threeClips();
    const track = videoTrack(base);

    const doc = edit(base, (d) => {
      edits.threePointEdit(d, track.id, {
        assetId: "a",
        inPointFrames: 200,
        outPointFrames: 245,
        atFrame: 90,
        mode: "overwrite",
      });
    });

    const added = videoTrack(doc).clips.find((c) => c.startFrame === 90)!;
    expect(added.durationFrames).toBe(45);
    expect(added.inPointFrames).toBe(200);
  });

  it("ripples when asked to insert", () => {
    const base = threeClips();
    const track = videoTrack(base);

    const doc = edit(base, (d) => {
      edits.threePointEdit(d, track.id, {
        assetId: "a",
        inPointFrames: 0,
        outPointFrames: 15,
        atFrame: 0,
        mode: "insert",
      });
    });

    expect(layout(doc)).toEqual([
      [0, 15],
      [15, 30],
      [45, 30],
      [75, 30],
    ]);
  });

  it("refuses a range with nothing in it", () => {
    // An out point at or before the in point is a mis-mark, not a request for
    // a zero-length clip.
    const base = threeClips();
    const track = videoTrack(base);
    const before = layout(base);

    const doc = edit(base, (d) => {
      expect(
        edits.threePointEdit(d, track.id, {
          assetId: "a",
          inPointFrames: 100,
          outPointFrames: 100,
          atFrame: 0,
          mode: "overwrite",
        }),
      ).toBeUndefined();
    });
    expect(layout(doc)).toEqual(before);
  });

  it("will not read past the end of the source", () => {
    const base = threeClips();
    const track = videoTrack(base);

    const doc = edit(base, (d) => {
      edits.threePointEdit(d, track.id, {
        assetId: "a",
        inPointFrames: SOURCE_FRAMES - 10,
        outPointFrames: SOURCE_FRAMES + 500,
        atFrame: 200,
        mode: "overwrite",
      });
    });

    const added = videoTrack(doc).clips.find((c) => c.startFrame === 200)!;
    expect(added.inPointFrames + added.durationFrames).toBeLessThanOrEqual(
      SOURCE_FRAMES,
    );
  });

  it("does nothing on a locked track", () => {
    const base = create(threeClips(), (d) => {
      videoTrack(d).locked = true;
    });
    const track = videoTrack(base);
    const before = layout(base);

    const doc = edit(base, (d) => {
      edits.threePointEdit(d, track.id, {
        assetId: "a",
        inPointFrames: 0,
        outPointFrames: 30,
        atFrame: 0,
        mode: "insert",
      });
    });
    expect(layout(doc)).toEqual(before);
  });
});
