import { describe, it, expect } from "vitest";
import { create } from "mutative";
import * as edits from "@/model/edits";
import {
  createEmptyDoc,
  clipEndFrame,
  type Asset,
  type ProjectDoc,
  type Track,
} from "@/model/doc";
import { assertDocValid } from "@/model/invariants";
import { FPS_30 } from "@/lib/timecode";

/**
 * Roll, ripple and slide.
 *
 * The tools existed in the toolbar and set a state variable nothing read. What
 * makes them worth testing is that each one has to refuse rather than fake it:
 * an edit that needs source material the clip does not have would otherwise
 * produce a silent freeze frame, which looks like a rendering bug rather than
 * an editing mistake.
 */

const SOURCE_FRAMES = 300;

function asset(id = "a"): Asset {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    size: 1,
    durationSec: SOURCE_FRAMES / 30,
    hasAudio: true,
  };
}

/** Three butted clips, each with handles on both sides. */
function threeClips(): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    d.sequence.frameRate = FPS_30;
    edits.upsertAsset(d, asset());
    const track = d.tracks.find((t) => t.kind === "video")!;
    for (let i = 0; i < 3; i++) {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: i * 30,
        mode: "overwrite",
        // Room to grow in both directions.
        inPointFrames: 60,
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

describe("roll", () => {
  it("moves the cut without changing the total length", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const before = clipEndFrame(videoTrack(base).clips[2]);

    const doc = edit(base, (d) => {
      edits.rollEdit(d, track.id, track.clips[0].id, 10);
    });

    expect(layout(doc)).toEqual([
      [0, 40],
      [40, 20],
      [60, 30],
    ]);
    expect(clipEndFrame(videoTrack(doc).clips[2])).toBe(before);
  });

  it("rolls the other way too", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rollEdit(d, track.id, track.clips[0].id, -10);
    });

    expect(layout(doc)).toEqual([
      [0, 20],
      [20, 40],
      [60, 30],
    ]);
  });

  it("keeps the incoming clip on the same source frame at the new cut", () => {
    // A roll must not slip either side: what plays after the cut should be
    // the material that was always there, just starting earlier or later.
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rollEdit(d, track.id, track.clips[0].id, 10);
    });

    const right = videoTrack(doc).clips[1];
    // The cut moved 10 frames later, so the incoming clip starts 10 frames
    // further into its source.
    expect(right.inPointFrames).toBe(70);
    // Its out point is unchanged.
    expect(right.inPointFrames + right.durationFrames).toBe(90);
  });

  it("refuses to consume a clip entirely", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rollEdit(d, track.id, track.clips[0].id, 1000);
    });

    const clips = videoTrack(doc).clips;
    expect(clips).toHaveLength(3);
    expect(clips[1].durationFrames).toBeGreaterThanOrEqual(1);
  });

  it("stops at the end of the outgoing clip's material", () => {
    // The left clip can only grow into frames it actually has.
    const base = create(threeClips(), (d) => {
      // Only 5 frames left past its out point.
      const track = videoTrack(d);
      track.clips[0].inPointFrames = SOURCE_FRAMES - 35;
    });
    const track = videoTrack(base);

    const moved = create(base, (d) => {
      const by = edits.rollEdit(d, track.id, track.clips[0].id, 20);
      expect(by).toBeLessThanOrEqual(5);
    });
    const left = videoTrack(moved).clips[0];
    expect(left.inPointFrames + left.durationFrames).toBeLessThanOrEqual(SOURCE_FRAMES);
  });

  it("does nothing across a gap", () => {
    // There is no single cut to roll if the clips do not touch.
    const base = create(threeClips(), (d) => {
      const track = videoTrack(d);
      track.clips[1].startFrame = 50;
      track.clips[2].startFrame = 90;
    });
    const track = videoTrack(base);

    const doc = edit(base, (d) => {
      expect(edits.rollEdit(d, track.id, track.clips[0].id, 10)).toBe(0);
    });
    expect(layout(doc)).toEqual(layout(base));
  });

  it("does nothing on the last clip", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      expect(edits.rollEdit(d, track.id, track.clips[2].id, 10)).toBe(0);
    });
    expect(layout(doc)).toEqual(layout(base));
  });
});

describe("ripple trim", () => {
  it("shortens the sequence when the tail is pulled in", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rippleTrim(d, track.id, track.clips[0].id, "end", 20);
    });

    // Everything after closes up: no gap is left behind.
    expect(layout(doc)).toEqual([
      [0, 20],
      [20, 30],
      [50, 30],
    ]);
  });

  it("lengthens the sequence when the tail is pushed out", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rippleTrim(d, track.id, track.clips[0].id, "end", 45);
    });

    expect(layout(doc)).toEqual([
      [0, 45],
      [45, 30],
      [75, 30],
    ]);
  });

  it("closes the gap when the head is trimmed", () => {
    // A head ripple removes frames from the front and pulls the clip — and
    // everything after it — back, rather than leaving a hole.
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rippleTrim(d, track.id, track.clips[1].id, "start", 40);
    });

    expect(layout(doc)).toEqual([
      [0, 30],
      [30, 20],
      [50, 30],
    ]);
  });

  it("advances the in-point when the head is trimmed", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rippleTrim(d, track.id, track.clips[1].id, "start", 40);
    });
    expect(videoTrack(doc).clips[1].inPointFrames).toBe(70);
  });

  it("reports how far the tail moved", () => {
    const base = threeClips();
    const track = videoTrack(base);
    create(base, (d) => {
      expect(edits.rippleTrim(d, track.id, track.clips[0].id, "end", 20)).toBe(-10);
      // A second call reports relative to the state it finds.
    });
  });

  it("leaves clips on other tracks alone", () => {
    // Rippling one track is the common case; syncing others is a separate
    // decision the caller makes, not something buried in the edit.
    const base = create(threeClips(), (d) => {
      const audio = d.tracks.find((t) => t.kind === "audio")!;
      edits.insertClip(d, audio.id, { type: "asset", assetId: "a" }, 90, {
        startFrame: 0,
      });
    });
    const track = videoTrack(base);

    const doc = edit(base, (d) => {
      edits.rippleTrim(d, track.id, track.clips[0].id, "end", 20);
    });
    const audio = doc.tracks.find((t) => t.kind === "audio")!;
    expect(audio.clips[0].durationFrames).toBe(90);
  });

  it("never leaves a negative start frame", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.rippleTrim(d, track.id, track.clips[2].id, "end", 0);
    });
    for (const clip of videoTrack(doc).clips) {
      expect(clip.startFrame).toBeGreaterThanOrEqual(0);
      expect(clip.durationFrames).toBeGreaterThan(0);
    }
  });
});

describe("transitions survive a roll", () => {
  function withTransition(): { doc: ProjectDoc; trackId: string; leftId: string } {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = create(base, (d) => {
      const t = videoTrack(d);
      edits.addTransition(d, t.id, t.clips[0].id, t.clips[1].id, "crossfade", 10);
    });
    return { doc, trackId: track.id, leftId: track.clips[0].id };
  }

  it("shortens a transition the roll no longer leaves room for", () => {
    const { doc: base, trackId, leftId } = withTransition();
    expect(videoTrack(base).transitions[0].durationFrames).toBe(10);

    // Roll until the right clip has almost nothing left.
    const doc = edit(base, (d) => {
      edits.rollEdit(d, trackId, leftId, 28);
    });

    const transition = videoTrack(doc).transitions[0];
    const right = videoTrack(doc).clips[1];
    expect(transition.durationFrames).toBeLessThanOrEqual(right.durationFrames - 1);
  });
});

describe("slip", () => {
  it("changes what is shown without moving the clip", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.slipClip(d, track.id, track.clips[1].id, 10);
    });

    expect(layout(doc)).toEqual(layout(base));
    expect(videoTrack(doc).clips[1].inPointFrames).toBe(70);
  });

  it("stops at the head of the source", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.slipClip(d, track.id, track.clips[1].id, -1000);
    });
    expect(videoTrack(doc).clips[1].inPointFrames).toBe(0);
  });

  it("stops at the tail of the source", () => {
    const base = threeClips();
    const track = videoTrack(base);
    const doc = edit(base, (d) => {
      edits.slipClip(d, track.id, track.clips[1].id, 1000);
    });
    const clip = videoTrack(doc).clips[1];
    expect(clip.inPointFrames + clip.durationFrames).toBeLessThanOrEqual(SOURCE_FRAMES);
  });
});
