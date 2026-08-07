import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { create } from "mutative";
import {
  createEmptyDoc,
  clipEndFrame,
  clipAt,
  contentEndFrame,
  type ProjectDoc,
  type Asset,
  type Clip,
} from "@/model/doc";
import { validateDoc, assertDocValid } from "@/model/invariants";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";

// ── Fixtures ──────────────────────────────────────────────────────────

/** 10 seconds at 30fps = 300 source frames. */
function asset(id: string, durationSec = 10): Asset {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    size: 1000,
    durationSec,
    hasAudio: true,
    width: 1920,
    height: 1080,
  };
}

function baseDoc(): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    edits.upsertAsset(d, asset("a"));
    edits.upsertAsset(d, asset("b"));
  });
}

/**
 * Applies a recipe and asserts the result is still a valid document.
 *
 * The recipe's return value is discarded: edit operations return the clips they
 * created, and an arrow shorthand would hand that draft object back to
 * `create`, which rejects returning a draft.
 */
function edit(doc: ProjectDoc, fn: (d: ProjectDoc) => unknown): ProjectDoc {
  const next = create(doc, (d) => {
    fn(d);
  });
  assertDocValid(next);
  return next;
}

function videoTrackId(doc: ProjectDoc): string {
  return doc.tracks.find((t) => t.kind === "video")!.id;
}

function clipsOf(doc: ProjectDoc, trackId: string): Clip[] {
  return doc.tracks.find((t) => t.id === trackId)!.clips;
}

/** Inserts a clip at an exact frame, overwriting anything in the way. */
function place(
  doc: ProjectDoc,
  trackId: string,
  startFrame: number,
  durationFrames: number,
  assetId = "a",
): ProjectDoc {
  return edit(doc, (d) => {
    edits.insertClip(d, trackId, { type: "asset", assetId }, durationFrames, {
      startFrame,
      mode: "overwrite",
    });
  });
}

// ── Insert ────────────────────────────────────────────────────────────

describe("insertClip", () => {
  it("places a clip at the requested frame", () => {
    const doc = baseDoc();
    const t = videoTrackId(doc);
    const next = place(doc, t, 30, 60);
    expect(clipsOf(next, t)).toHaveLength(1);
    expect(clipsOf(next, t)[0].startFrame).toBe(30);
    expect(clipsOf(next, t)[0].durationFrames).toBe(60);
  });

  it("finds the next free slot in fit mode instead of overlapping", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 60);
    doc = edit(doc, (d) => {
      edits.insertClip(d, t, { type: "asset", assetId: "a" }, 60, {
        startFrame: 30,
        mode: "fit",
      });
    });
    expect(clipsOf(doc, t).map((c) => c.startFrame)).toEqual([0, 60]);
  });

  it("clamps a clip longer than its source", () => {
    // Asset "a" is 10s = 300 frames; asking for 600 must not create a clip
    // that reads past the end of the media.
    const doc = baseDoc();
    const t = videoTrackId(doc);
    const next = place(doc, t, 0, 600);
    expect(clipsOf(next, t)[0].durationFrames).toBe(300);
  });

  it("does not clamp when the asset duration is unknown", () => {
    // An unprobed or offline asset must not silently truncate the user's clip.
    const doc = create(createEmptyDoc(), (d) => {
      edits.upsertAsset(d, { ...asset("unknown"), durationSec: 0 });
    });
    const t = videoTrackId(doc);
    const next = place(doc, t, 0, 600, "unknown");
    expect(clipsOf(next, t)[0].durationFrames).toBe(600);
  });

  it("refuses to write to a locked track", () => {
    const doc = baseDoc();
    const t = videoTrackId(doc);
    const locked = edit(doc, (d) => edits.setTrackFlag(d, t, "locked", true));
    const next = edit(locked, (d) => {
      edits.insertClip(d, t, { type: "asset", assetId: "a" }, 60, { startFrame: 0 });
    });
    expect(clipsOf(next, t)).toHaveLength(0);
  });
});

// ── Split ─────────────────────────────────────────────────────────────

describe("splitClip", () => {
  it("produces two adjacent halves covering the original", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 10, 100);
    const id = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.splitClip(d, t, id, 50));
    const [left, right] = clipsOf(doc, t);

    expect(left.startFrame).toBe(10);
    expect(left.durationFrames).toBe(40);
    expect(right.startFrame).toBe(50);
    expect(right.durationFrames).toBe(60);
    expect(clipEndFrame(right)).toBe(110);
  });

  it("advances the right half's in-point so content is continuous", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 100);
    const id = clipsOf(doc, t)[0].id;
    doc = edit(doc, (d) => edits.splitClip(d, t, id, 40));

    const [left, right] = clipsOf(doc, t);
    expect(right.inPointFrames).toBe(left.inPointFrames + 40);
  });

  it("keeps clips sorted when splitting an earlier clip", () => {
    // The old implementation pushed the new half onto the end of the array, so
    // after a cut the clip order no longer matched the timeline order.
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 60);
    doc = place(doc, t, 100, 60);
    const first = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.splitClip(d, t, first, 30));
    const starts = clipsOf(doc, t).map((c) => c.startFrame);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts).toEqual([0, 30, 100]);
  });

  it("refuses a split that would leave a zero-length half", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 10, 100);
    const id = clipsOf(doc, t)[0].id;

    for (const at of [10, 110, 5, 200]) {
      const next = edit(doc, (d) => {
        edits.splitClip(d, t, id, at);
      });
      expect(clipsOf(next, t)).toHaveLength(1);
    }
  });

  it("gives the halves distinct ids", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 100);
    const id = clipsOf(doc, t)[0].id;
    doc = edit(doc, (d) => edits.splitClip(d, t, id, 50));
    const [left, right] = clipsOf(doc, t);
    expect(left.id).not.toBe(right.id);
  });
});

// ── Trim ──────────────────────────────────────────────────────────────

describe("trimClipEnd", () => {
  it("shortens a clip", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 200);
    const id = clipsOf(doc, t)[0].id;
    doc = edit(doc, (d) => edits.trimClipEnd(d, t, id, 100));
    expect(clipsOf(doc, t)[0].durationFrames).toBe(100);
  });

  it("will not extend past the end of the source", () => {
    // This is the bug: the old trim clamped only the minimum, so dragging the
    // right handle forever produced a silent freeze frame.
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 100);
    const id = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.trimClipEnd(d, t, id, 99999));
    const clip = clipsOf(doc, t)[0];
    expect(clip.durationFrames).toBe(300); // asset is 10s at 30fps
    expect(validateDoc(doc)).toEqual([]);
  });

  it("will not extend into the next clip", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 60);
    doc = place(doc, t, 100, 60);
    const first = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.trimClipEnd(d, t, first, 150));
    expect(clipEndFrame(clipsOf(doc, t)[0])).toBe(100);
  });

  it("always leaves at least one frame", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 10, 100);
    const id = clipsOf(doc, t)[0].id;
    doc = edit(doc, (d) => edits.trimClipEnd(d, t, id, -500));
    expect(clipsOf(doc, t)[0].durationFrames).toBeGreaterThanOrEqual(1);
  });
});

describe("trimClipStart", () => {
  it("moves start and in-point together so content stays put", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 200);
    const id = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.trimClipStart(d, t, id, 50));
    const clip = clipsOf(doc, t)[0];
    expect(clip.startFrame).toBe(50);
    expect(clip.inPointFrames).toBe(50);
    expect(clipEndFrame(clip)).toBe(200);
  });

  it("will not extend before the head of the source", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 100, 100);
    const id = clipsOf(doc, t)[0].id;

    // in-point is 0, so there is nothing before it to reveal.
    doc = edit(doc, (d) => edits.trimClipStart(d, t, id, 0));
    expect(clipsOf(doc, t)[0].startFrame).toBe(100);
  });

  it("will not extend into the previous clip", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 60);
    doc = place(doc, t, 100, 60);
    const second = clipsOf(doc, t)[1].id;

    // Give it headroom in the source so only the neighbour constrains it.
    doc = edit(doc, (d) => {
      const c = d.tracks.find((x) => x.id === t)!.clips[1];
      c.inPointFrames = 100;
    });
    doc = edit(doc, (d) => edits.trimClipStart(d, t, second, 20));
    expect(clipsOf(doc, t)[1].startFrame).toBe(60);
  });
});

// ── Move ──────────────────────────────────────────────────────────────

describe("moveClip", () => {
  it("moves within a track", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 60);
    const id = clipsOf(doc, t)[0].id;
    doc = edit(doc, (d) => edits.moveClip(d, t, id, 200));
    expect(clipsOf(doc, t)[0].startFrame).toBe(200);
  });

  it("moves between tracks of the same kind", () => {
    // Cross-track moves were impossible before — moveClip only changed
    // startTime within one track.
    let doc = baseDoc();
    const [v1, v2] = doc.tracks.filter((x) => x.kind === "video");
    doc = place(doc, v1.id, 0, 60);
    const id = clipsOf(doc, v1.id)[0].id;

    doc = edit(doc, (d) => edits.moveClip(d, v1.id, id, 30, { toTrackId: v2.id }));
    expect(clipsOf(doc, v1.id)).toHaveLength(0);
    expect(clipsOf(doc, v2.id)).toHaveLength(1);
    expect(clipsOf(doc, v2.id)[0].startFrame).toBe(30);
  });

  it("refuses to move a video clip onto an audio track", () => {
    let doc = baseDoc();
    const v = videoTrackId(doc);
    const a = doc.tracks.find((x) => x.kind === "audio")!.id;
    doc = place(doc, v, 0, 60);
    const id = clipsOf(doc, v)[0].id;

    doc = edit(doc, (d) => edits.moveClip(d, v, id, 0, { toTrackId: a }));
    expect(clipsOf(doc, v)).toHaveLength(1);
    expect(clipsOf(doc, a)).toHaveLength(0);
  });

  it("never produces an overlap in fit mode", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 60);
    doc = place(doc, t, 100, 60);
    const second = clipsOf(doc, t)[1].id;

    // Aim it straight at the first clip.
    doc = edit(doc, (d) => edits.moveClip(d, t, second, 10));
    expect(validateDoc(doc)).toEqual([]);
  });

  it("clears the destination in overwrite mode", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 100);
    doc = place(doc, t, 200, 50);
    const second = clipsOf(doc, t)[1].id;

    doc = edit(doc, (d) => edits.moveClip(d, t, second, 20, { mode: "overwrite" }));
    expect(validateDoc(doc)).toEqual([]);
    expect(
      clipAt(
        doc.tracks.find((x) => x.id === t)!,
        30,
      )?.id,
    ).toBe(second);
  });
});

// ── Ripple delete ─────────────────────────────────────────────────────

describe("rippleDelete", () => {
  it("closes the gap left behind", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 50);
    doc = place(doc, t, 50, 50);
    doc = place(doc, t, 100, 50);
    const middle = clipsOf(doc, t)[1].id;

    doc = edit(doc, (d) => edits.rippleDelete(d, [{ trackId: t, clipId: middle }]));
    expect(clipsOf(doc, t).map((c) => c.startFrame)).toEqual([0, 50]);
  });

  it("handles several removals on one track", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    for (let i = 0; i < 5; i++) doc = place(doc, t, i * 50, 50);
    const clips = clipsOf(doc, t);
    const refs = [clips[1], clips[3]].map((c) => ({ trackId: t, clipId: c.id }));

    doc = edit(doc, (d) => edits.rippleDelete(d, refs));
    expect(clipsOf(doc, t).map((c) => c.startFrame)).toEqual([0, 50, 100]);
  });
});

// ── Slip and slide ────────────────────────────────────────────────────

describe("slipClip", () => {
  it("changes the in-point without moving or resizing the clip", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 30, 60);
    const id = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.slipClip(d, t, id, 20));
    const clip = clipsOf(doc, t)[0];
    expect(clip.startFrame).toBe(30);
    expect(clip.durationFrames).toBe(60);
    expect(clip.inPointFrames).toBe(20);
  });

  it("clamps at both ends of the source", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 60);
    const id = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.slipClip(d, t, id, -100));
    expect(clipsOf(doc, t)[0].inPointFrames).toBe(0);

    doc = edit(doc, (d) => edits.slipClip(d, t, id, 99999));
    expect(clipsOf(doc, t)[0].inPointFrames).toBe(300 - 60);
    expect(validateDoc(doc)).toEqual([]);
  });
});

describe("slideClip", () => {
  it("absorbs the shift into the neighbours", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 50);
    doc = place(doc, t, 50, 50);
    doc = place(doc, t, 100, 50);
    const middle = clipsOf(doc, t)[1].id;
    const totalBefore = contentEndFrame(doc);

    doc = edit(doc, (d) => edits.slideClip(d, t, middle, 10));
    const [a, b, c] = clipsOf(doc, t);
    expect(a.durationFrames).toBe(60);
    expect(b.startFrame).toBe(60);
    expect(b.durationFrames).toBe(50);
    expect(c.startFrame).toBe(110);
    // The arrangement keeps its overall length.
    expect(contentEndFrame(doc)).toBe(totalBefore);
  });

  it("will not consume a neighbour entirely", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 50);
    doc = place(doc, t, 50, 50);
    doc = place(doc, t, 100, 50);
    const middle = clipsOf(doc, t)[1].id;

    doc = edit(doc, (d) => edits.slideClip(d, t, middle, 9999));
    expect(validateDoc(doc)).toEqual([]);
    expect(clipsOf(doc, t).every((c) => c.durationFrames >= 1)).toBe(true);
  });
});

// ── Speed ─────────────────────────────────────────────────────────────

describe("setClipSpeed", () => {
  it("halves the timeline length at 2x", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 100);
    const id = clipsOf(doc, t)[0].id;

    doc = edit(doc, (d) => edits.setClipSpeed(d, t, id, 2));
    expect(clipsOf(doc, t)[0].durationFrames).toBe(50);
    expect(clipsOf(doc, t)[0].speed).toBe(2);
  });

  it("rejects zero and negative speeds", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 100);
    const id = clipsOf(doc, t)[0].id;

    for (const bad of [0, -1, NaN, Infinity]) {
      const next = edit(doc, (d) => edits.setClipSpeed(d, t, id, bad));
      expect(clipsOf(next, t)[0].speed).toBe(1);
    }
  });
});

// ── Transitions ───────────────────────────────────────────────────────

describe("addTransition", () => {
  it("refuses clips that are not adjacent", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 50);
    doc = place(doc, t, 100, 50);
    const [a, b] = clipsOf(doc, t);

    doc = edit(doc, (d) => {
      edits.addTransition(d, t, a.id, b.id, "crossfade", 10);
    });
    expect(doc.tracks.find((x) => x.id === t)!.transitions).toHaveLength(0);
  });

  it("refuses when the right clip has no handles to reach back into", () => {
    // A crossfade needs frames outside the visible in/out on both sides.
    // Producing a freeze frame instead would be worse than refusing.
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 50);
    doc = place(doc, t, 50, 50);
    const [a, b] = clipsOf(doc, t);
    expect(b.inPointFrames).toBe(0);

    doc = edit(doc, (d) => {
      edits.addTransition(d, t, a.id, b.id, "crossfade", 10);
    });
    expect(doc.tracks.find((x) => x.id === t)!.transitions).toHaveLength(0);
  });

  it("creates a transition when both sides have handles", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 50);
    doc = place(doc, t, 50, 50);
    const [a, b] = clipsOf(doc, t);

    doc = edit(doc, (d) => {
      const clip = d.tracks.find((x) => x.id === t)!.clips[1];
      clip.inPointFrames = 60; // give the right clip a handle
    });
    doc = edit(doc, (d) => {
      edits.addTransition(d, t, a.id, b.id, "crossfade", 10);
    });

    const transitions = doc.tracks.find((x) => x.id === t)!.transitions;
    expect(transitions).toHaveLength(1);
    expect(transitions[0].durationFrames).toBe(10);
  });

  it("drops transitions whose clips are deleted", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 0, 50);
    doc = place(doc, t, 50, 50);
    doc = edit(doc, (d) => {
      d.tracks.find((x) => x.id === t)!.clips[1].inPointFrames = 60;
    });
    const [a, b] = clipsOf(doc, t);
    doc = edit(doc, (d) => {
      edits.addTransition(d, t, a.id, b.id, "crossfade", 10);
    });
    expect(doc.tracks.find((x) => x.id === t)!.transitions).toHaveLength(1);

    doc = edit(doc, (d) => edits.removeClip(d, t, b.id));
    expect(doc.tracks.find((x) => x.id === t)!.transitions).toHaveLength(0);
  });
});

// ── Property tests ────────────────────────────────────────────────────

type Op =
  | { op: "insert"; start: number; length: number }
  | { op: "split"; index: number; at: number }
  | { op: "trimEnd"; index: number; to: number }
  | { op: "trimStart"; index: number; to: number }
  | { op: "move"; index: number; to: number; track: number }
  | { op: "slip"; index: number; delta: number }
  | { op: "slide"; index: number; delta: number }
  | { op: "speed"; index: number; speed: number }
  | { op: "remove"; index: number }
  | { op: "ripple"; index: number };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    op: fc.constant("insert" as const),
    start: fc.integer({ min: 0, max: 400 }),
    length: fc.integer({ min: 1, max: 200 }),
  }),
  fc.record({
    op: fc.constant("split" as const),
    index: fc.nat(5),
    at: fc.integer({ min: -50, max: 500 }),
  }),
  fc.record({
    op: fc.constant("trimEnd" as const),
    index: fc.nat(5),
    to: fc.integer({ min: -100, max: 900 }),
  }),
  fc.record({
    op: fc.constant("trimStart" as const),
    index: fc.nat(5),
    to: fc.integer({ min: -100, max: 900 }),
  }),
  fc.record({
    op: fc.constant("move" as const),
    index: fc.nat(5),
    to: fc.integer({ min: -50, max: 600 }),
    track: fc.nat(1),
  }),
  fc.record({
    op: fc.constant("slip" as const),
    index: fc.nat(5),
    delta: fc.integer({ min: -400, max: 400 }),
  }),
  fc.record({
    op: fc.constant("slide" as const),
    index: fc.nat(5),
    delta: fc.integer({ min: -200, max: 200 }),
  }),
  fc.record({
    op: fc.constant("speed" as const),
    index: fc.nat(5),
    speed: fc.constantFrom(0.25, 0.5, 1, 2, 4),
  }),
  fc.record({ op: fc.constant("remove" as const), index: fc.nat(5) }),
  fc.record({ op: fc.constant("ripple" as const), index: fc.nat(5) }),
);

function applyOp(doc: ProjectDoc, op: Op): ProjectDoc {
  const videoTracks = doc.tracks.filter((t) => t.kind === "video");
  const t = videoTracks[0];
  const clips = t.clips;
  const pick = (i: number) => clips[i % Math.max(1, clips.length)];

  return create(doc, (d) => {
    switch (op.op) {
      case "insert":
        edits.insertClip(d, t.id, { type: "asset", assetId: "a" }, op.length, {
          startFrame: op.start,
          mode: "fit",
        });
        break;
      case "split":
        if (clips.length) edits.splitClip(d, t.id, pick(op.index).id, op.at);
        break;
      case "trimEnd":
        if (clips.length) edits.trimClipEnd(d, t.id, pick(op.index).id, op.to);
        break;
      case "trimStart":
        if (clips.length) edits.trimClipStart(d, t.id, pick(op.index).id, op.to);
        break;
      case "move":
        if (clips.length) {
          edits.moveClip(d, t.id, pick(op.index).id, op.to, {
            toTrackId: videoTracks[op.track % videoTracks.length].id,
          });
        }
        break;
      case "slip":
        if (clips.length) edits.slipClip(d, t.id, pick(op.index).id, op.delta);
        break;
      case "slide":
        if (clips.length) edits.slideClip(d, t.id, pick(op.index).id, op.delta);
        break;
      case "speed":
        if (clips.length) edits.setClipSpeed(d, t.id, pick(op.index).id, op.speed);
        break;
      case "remove":
        if (clips.length) edits.removeClip(d, t.id, pick(op.index).id);
        break;
      case "ripple":
        if (clips.length) {
          edits.rippleDelete(d, [{ trackId: t.id, clipId: pick(op.index).id }]);
        }
        break;
    }
  });
}

describe("invariants hold under arbitrary edit sequences", () => {
  it("never produces an invalid document", () => {
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 1, maxLength: 40 }), (ops) => {
        let doc = baseDoc();
        for (const op of ops) {
          doc = applyOp(doc, op);
          const violations = validateDoc(doc);
          if (violations.length > 0) {
            throw new Error(
              `after ${op.op}: ${violations.map((v) => `${v.path}: ${v.message}`).join("; ")}`,
            );
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("keeps clips sorted and non-overlapping", () => {
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 1, maxLength: 40 }), (ops) => {
        let doc = baseDoc();
        for (const op of ops) doc = applyOp(doc, op);

        for (const t of doc.tracks) {
          for (let i = 1; i < t.clips.length; i++) {
            expect(t.clips[i].startFrame).toBeGreaterThanOrEqual(
              clipEndFrame(t.clips[i - 1]),
            );
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("keeps every clip inside its source media", () => {
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 1, maxLength: 40 }), (ops) => {
        let doc = baseDoc();
        for (const op of ops) doc = applyOp(doc, op);

        for (const t of doc.tracks) {
          for (const clip of t.clips) {
            expect(clip.inPointFrames).toBeGreaterThanOrEqual(0);
            expect(clip.durationFrames).toBeGreaterThan(0);
            const source = clip.source;
            if (source.type === "asset") {
              const a = doc.assets.find((x) => x.id === source.assetId)!;
              const available = Math.round(a.durationSec * 30);
              expect(
                clip.inPointFrames + Math.round(clip.durationFrames * clip.speed),
              ).toBeLessThanOrEqual(available);
            }
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("keeps all times integral", () => {
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 1, maxLength: 30 }), (ops) => {
        let doc = baseDoc();
        for (const op of ops) doc = applyOp(doc, op);

        for (const t of doc.tracks) {
          for (const clip of t.clips) {
            expect(Number.isInteger(clip.startFrame)).toBe(true);
            expect(Number.isInteger(clip.durationFrames)).toBe(true);
            expect(Number.isInteger(clip.inPointFrames)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("clipAt", () => {
  it("finds the clip covering a frame and nothing outside it", () => {
    let doc = baseDoc();
    const t = videoTrackId(doc);
    doc = place(doc, t, 10, 20);
    const track = doc.tracks.find((x) => x.id === t)!;

    expect(clipAt(track, 9)).toBeUndefined();
    expect(clipAt(track, 10)?.startFrame).toBe(10);
    expect(clipAt(track, 29)?.startFrame).toBe(10);
    // End frame is exclusive: [10, 30).
    expect(clipAt(track, 30)).toBeUndefined();
  });
});

describe("frame rate independence", () => {
  it("clamps against the source at whatever rate the sequence uses", () => {
    // The same 10s asset is 240 frames at 24fps, not 300.
    const doc = create(createEmptyDoc(), (d) => {
      edits.upsertAsset(d, asset("a"));
      edits.setSequence(d, { frameRate: { num: 24, den: 1 } });
    });
    const t = videoTrackId(doc);
    const next = place(doc, t, 0, 9999);
    expect(clipsOf(next, t)[0].durationFrames).toBe(240);
    expect(FPS_30.num).toBe(30); // guard against the fixture drifting
  });
});

describe("clips may only reference known assets", () => {
  it("rejects a clip whose asset was never registered", () => {
    // The contract media import has to satisfy: an entry in the media pool is
    // not enough, the document's asset table must know about it too. Dropping
    // unregistered media on the timeline used to throw here.
    const doc = createEmptyDoc();
    const t = videoTrackId(doc);
    const withOrphan = create(doc, (d) => {
      edits.insertClip(d, t, { type: "asset", assetId: "never-imported" }, 60, {
        startFrame: 0,
      });
    });

    const violations = validateDoc(withOrphan);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/unknown asset/);
  });

  it("accepts the same clip once the asset is registered", () => {
    const doc = create(createEmptyDoc(), (d) => {
      edits.upsertAsset(d, asset("registered"));
    });
    const t = videoTrackId(doc);
    const next = edit(doc, (d) => {
      edits.insertClip(d, t, { type: "asset", assetId: "registered" }, 60, {
        startFrame: 0,
      });
    });
    expect(validateDoc(next)).toEqual([]);
  });

  it("clamps a clip to the source length on insert", () => {
    // Dropping a 30s clip from a 10s file must produce a 10s clip, not one
    // that reads past the end into a silent freeze frame.
    const doc = baseDoc();
    const t = videoTrackId(doc);
    const next = edit(doc, (d) => {
      edits.insertClip(d, t, { type: "asset", assetId: "a" }, 900, {
        startFrame: 0,
      });
    });
    expect(clipsOf(next, t)[0].durationFrames).toBe(300);
  });
});
