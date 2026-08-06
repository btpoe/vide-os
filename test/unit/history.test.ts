import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { create } from "mutative";
import {
  createHistory,
  applyEdit,
  beginInteraction,
  commitInteraction,
  abortInteraction,
  undo,
  redo,
  canUndo,
  canRedo,
  historyEntries,
  goToEntry,
  resetHistory,
  MAX_HISTORY,
  COALESCE_WINDOW_MS,
  type HistoryState,
} from "@/model/history";
import { createEmptyDoc, type ProjectDoc, type Asset } from "@/model/doc";
import * as edits from "@/model/edits";

function asset(id: string, durationSec = 10): Asset {
  return { id, name: `${id}.mp4`, kind: "video", size: 1, durationSec, hasAudio: true };
}

function startDoc(): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    edits.upsertAsset(d, asset("a"));
  });
}

function videoTrackId(doc: ProjectDoc): string {
  return doc.tracks.find((t) => t.kind === "video")!.id;
}

function clipCount(doc: ProjectDoc): number {
  return doc.tracks.reduce((n, t) => n + t.clips.length, 0);
}

function addClip(state: HistoryState, start = 0, length = 30): HistoryState {
  const t = videoTrackId(state.present);
  return applyEdit(state, "Add clip", (d) => {
    edits.insertClip(d, t, { type: "asset", assetId: "a" }, length, {
      startFrame: start,
      mode: "overwrite",
    });
  });
}

describe("basic undo/redo", () => {
  it("starts with nothing to undo", () => {
    const h = createHistory(startDoc());
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("undoes and redoes an edit", () => {
    let h = createHistory(startDoc());
    h = addClip(h);
    expect(clipCount(h.present)).toBe(1);

    h = undo(h);
    expect(clipCount(h.present)).toBe(0);
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(clipCount(h.present)).toBe(1);
  });

  it("restores clips with every field intact", () => {
    // This is the delete-undo bug: the old inverse re-added clips through
    // addClipToTrack, minting new ids and dropping effects, in/out points,
    // transitions and text overlays.
    let h = createHistory(startDoc());
    h = addClip(h, 0, 100);
    const t = videoTrackId(h.present);

    h = applyEdit(h, "Configure", (d) => {
      const clip = d.tracks.find((x) => x.id === t)!.clips[0];
      clip.inPointFrames = 42;
      clip.opacity = { value: 0.5 };
      clip.effects.push({
        id: "fx1",
        definitionId: "blur",
        enabled: true,
        params: { radius: { value: 3 } },
      });
    });
    const before = structuredClone(h.present.tracks.find((x) => x.id === t)!.clips[0]);

    const clipId = before.id;
    h = applyEdit(h, "Delete", (d) => edits.removeClip(d, t, clipId));
    expect(clipCount(h.present)).toBe(0);

    h = undo(h);
    const after = h.present.tracks.find((x) => x.id === t)!.clips[0];
    expect(after).toEqual(before);
    expect(after.id).toBe(clipId);
  });

  it("undoes a split completely", () => {
    // Split-undo used to be an explicit stub, leaving the left half truncated.
    let h = createHistory(startDoc());
    h = addClip(h, 0, 100);
    const t = videoTrackId(h.present);
    const before = structuredClone(h.present.tracks.find((x) => x.id === t)!.clips);
    const id = before[0].id;

    h = applyEdit(h, "Split", (d) => {
      edits.splitClip(d, t, id, 40);
    });
    expect(h.present.tracks.find((x) => x.id === t)!.clips).toHaveLength(2);

    h = undo(h);
    expect(h.present.tracks.find((x) => x.id === t)!.clips).toEqual(before);
  });

  it("redoes a trim", () => {
    // Trim-redo used to be an empty function, so redo after undo did nothing.
    let h = createHistory(startDoc());
    h = addClip(h, 0, 100);
    const t = videoTrackId(h.present);
    const id = h.present.tracks.find((x) => x.id === t)!.clips[0].id;

    h = applyEdit(h, "Trim", (d) => edits.trimClipEnd(d, t, id, 60));
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].durationFrames).toBe(60);

    h = undo(h);
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].durationFrames).toBe(100);

    h = redo(h);
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].durationFrames).toBe(60);
  });

  it("discards the redo stack on a new edit", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 30);
    h = addClip(h, 40, 30);
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    h = addClip(h, 100, 30);
    expect(canRedo(h)).toBe(false);
  });

  it("ignores an edit that changes nothing", () => {
    // Clicking a control without moving it must not bury the real last action.
    let h = createHistory(startDoc());
    h = addClip(h);
    const depth = h.past.length;

    h = applyEdit(h, "No-op", () => {
      /* touches nothing */
    });
    expect(h.past.length).toBe(depth);
  });

  it("is a no-op at the ends of the stack", () => {
    let h = createHistory(startDoc());
    expect(undo(h)).toBe(h);
    h = addClip(h);
    h = undo(h);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(redo(h)).toBe(h);
  });
});

describe("structural sharing", () => {
  it("shares untouched tracks between revisions", () => {
    // This is what makes snapshot undo affordable: an edit to one track must
    // not deep-copy the others.
    let h = createHistory(startDoc());
    const audioTrackBefore = h.present.tracks.find((t) => t.kind === "audio");

    h = addClip(h);
    const audioTrackAfter = h.present.tracks.find((t) => t.kind === "audio");
    expect(audioTrackAfter).toBe(audioTrackBefore);
  });

  it("leaves the previous document untouched", () => {
    let h = createHistory(startDoc());
    const original = h.present;
    const snapshot = JSON.stringify(original);

    h = addClip(h);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(h.present).not.toBe(original);
  });
});

describe("coalescing", () => {
  it("merges rapid edits sharing a key into one step", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 100);
    const t = videoTrackId(h.present);
    const id = h.present.tracks.find((x) => x.id === t)!.clips[0].id;
    const depth = h.past.length;

    // Clips start fully opaque; drag the slider down to 0.05 in 20 steps.
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].opacity.value).toBe(1);
    for (let i = 1; i <= 20; i++) {
      h = applyEdit(
        h,
        "Opacity",
        (d) => {
          d.tracks.find((x) => x.id === t)!.clips[0].opacity = {
            value: 1 - i / 20 + 0.05,
          };
        },
        { coalesceKey: `opacity:${id}`, now: 1000 + i * 10 },
      );
    }

    expect(h.past.length).toBe(depth + 1);
    expect(
      h.present.tracks.find((x) => x.id === t)!.clips[0].opacity.value,
    ).toBeCloseTo(0.05, 10);

    // One undo returns to before the whole drag, not to its first increment.
    h = undo(h);
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].opacity.value).toBe(1);
    expect(h.past.length).toBe(depth);
  });

  it("does not merge across the coalesce window", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 100);
    const t = videoTrackId(h.present);
    const depth = h.past.length;

    h = applyEdit(
      h,
      "Opacity",
      (d) => {
        d.tracks.find((x) => x.id === t)!.clips[0].opacity = { value: 0.5 };
      },
      { coalesceKey: "opacity", now: 1000 },
    );
    h = applyEdit(
      h,
      "Opacity",
      (d) => {
        d.tracks.find((x) => x.id === t)!.clips[0].opacity = { value: 0.2 };
      },
      { coalesceKey: "opacity", now: 1000 + COALESCE_WINDOW_MS + 1 },
    );

    expect(h.past.length).toBe(depth + 2);
  });

  it("does not merge different keys", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 100);
    const t = videoTrackId(h.present);
    const depth = h.past.length;

    h = applyEdit(
      h,
      "Opacity",
      (d) => {
        d.tracks.find((x) => x.id === t)!.clips[0].opacity = { value: 0.5 };
      },
      { coalesceKey: "opacity", now: 1000 },
    );
    h = applyEdit(
      h,
      "Volume",
      (d) => {
        d.tracks.find((x) => x.id === t)!.clips[0].volume = { value: 0.5 };
      },
      { coalesceKey: "volume", now: 1010 },
    );

    expect(h.past.length).toBe(depth + 2);
  });
});

describe("interactions", () => {
  it("records a whole drag as one step", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 30);
    const t = videoTrackId(h.present);
    const id = h.present.tracks.find((x) => x.id === t)!.clips[0].id;
    const depth = h.past.length;

    h = beginInteraction(h);
    for (let frame = 1; frame <= 100; frame++) {
      h = applyEdit(h, "Move", (d) => edits.moveClip(d, t, id, frame));
    }
    h = commitInteraction(h, "Move clip");

    expect(h.past.length).toBe(depth + 1);
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].startFrame).toBe(100);

    h = undo(h);
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].startFrame).toBe(0);
  });

  it("records nothing for a drag that ends where it started", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 30);
    const t = videoTrackId(h.present);
    const id = h.present.tracks.find((x) => x.id === t)!.clips[0].id;
    const depth = h.past.length;

    h = beginInteraction(h);
    h = applyEdit(h, "Move", (d) => edits.moveClip(d, t, id, 50));
    h = applyEdit(h, "Move", (d) => edits.moveClip(d, t, id, 0));
    h = commitInteraction(h, "Move clip");

    expect(h.past.length).toBe(depth);
  });

  it("restores the pre-drag document on abort", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 30);
    const t = videoTrackId(h.present);
    const id = h.present.tracks.find((x) => x.id === t)!.clips[0].id;
    const before = h.present;

    h = beginInteraction(h);
    h = applyEdit(h, "Move", (d) => edits.moveClip(d, t, id, 200));
    expect(h.present.tracks.find((x) => x.id === t)!.clips[0].startFrame).toBe(200);

    h = abortInteraction(h);
    expect(h.present).toBe(before);
    expect(h.interaction).toBeNull();
  });

  it("ignores a nested begin", () => {
    let h = createHistory(startDoc());
    h = beginInteraction(h);
    const first = h.interaction;
    h = beginInteraction(h);
    expect(h.interaction).toBe(first);
  });

  it("ignores commit without begin", () => {
    const h = createHistory(startDoc());
    expect(commitInteraction(h, "Nothing")).toBe(h);
  });
});

describe("history panel navigation", () => {
  it("lists entries with the present marked", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 30);
    h = addClip(h, 40, 30);

    const { entries, currentIndex } = historyEntries(h);
    expect(entries).toHaveLength(2);
    expect(currentIndex).toBe(2);
  });

  it("time-travels to an arbitrary point", () => {
    let h = createHistory(startDoc());
    h = addClip(h, 0, 30);
    h = addClip(h, 40, 30);
    h = addClip(h, 80, 30);
    expect(clipCount(h.present)).toBe(3);

    h = goToEntry(h, 1);
    expect(clipCount(h.present)).toBe(1);

    h = goToEntry(h, 3);
    expect(clipCount(h.present)).toBe(3);
  });

  it("clamps out-of-range targets", () => {
    let h = createHistory(startDoc());
    h = addClip(h);
    expect(clipCount(goToEntry(h, -5).present)).toBe(0);
    expect(clipCount(goToEntry(h, 99).present)).toBe(1);
  });
});

describe("bounds", () => {
  it("caps the undo depth", () => {
    let h = createHistory(startDoc());
    for (let i = 0; i < MAX_HISTORY + 50; i++) h = addClip(h, i * 40, 30);
    expect(h.past.length).toBe(MAX_HISTORY);
  });

  it("clears history on reset", () => {
    const edited = addClip(createHistory(startDoc()));
    expect(canUndo(edited)).toBe(true);

    const fresh = resetHistory(createEmptyDoc());
    expect(canUndo(fresh)).toBe(false);
    expect(canRedo(fresh)).toBe(false);
    expect(clipCount(fresh.present)).toBe(0);
  });
});

// ── Property test ─────────────────────────────────────────────────────

type Step =
  | { kind: "insert"; start: number; length: number }
  | { kind: "split"; index: number; at: number }
  | { kind: "trim"; index: number; to: number }
  | { kind: "move"; index: number; to: number }
  | { kind: "remove"; index: number }
  | { kind: "speed"; index: number; speed: number };

const arbStep: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant("insert" as const),
    start: fc.integer({ min: 0, max: 300 }),
    length: fc.integer({ min: 1, max: 100 }),
  }),
  fc.record({
    kind: fc.constant("split" as const),
    index: fc.nat(4),
    at: fc.integer({ min: 0, max: 300 }),
  }),
  fc.record({
    kind: fc.constant("trim" as const),
    index: fc.nat(4),
    to: fc.integer({ min: 0, max: 400 }),
  }),
  fc.record({
    kind: fc.constant("move" as const),
    index: fc.nat(4),
    to: fc.integer({ min: 0, max: 400 }),
  }),
  fc.record({ kind: fc.constant("remove" as const), index: fc.nat(4) }),
  fc.record({
    kind: fc.constant("speed" as const),
    index: fc.nat(4),
    speed: fc.constantFrom(0.5, 1, 2),
  }),
);

function applyStep(h: HistoryState, step: Step): HistoryState {
  const t = videoTrackId(h.present);
  const clips = h.present.tracks.find((x) => x.id === t)!.clips;
  const pick = (i: number) => clips[i % Math.max(1, clips.length)];

  return applyEdit(h, step.kind, (d) => {
    switch (step.kind) {
      case "insert":
        edits.insertClip(d, t, { type: "asset", assetId: "a" }, step.length, {
          startFrame: step.start,
          mode: "fit",
        });
        break;
      case "split":
        if (clips.length) edits.splitClip(d, t, pick(step.index).id, step.at);
        break;
      case "trim":
        if (clips.length) edits.trimClipEnd(d, t, pick(step.index).id, step.to);
        break;
      case "move":
        if (clips.length) edits.moveClip(d, t, pick(step.index).id, step.to);
        break;
      case "remove":
        if (clips.length) edits.removeClip(d, t, pick(step.index).id);
        break;
      case "speed":
        if (clips.length) edits.setClipSpeed(d, t, pick(step.index).id, step.speed);
        break;
    }
  });
}

describe("undoing everything restores the original document", () => {
  it("holds for arbitrary edit sequences", () => {
    fc.assert(
      fc.property(fc.array(arbStep, { minLength: 1, maxLength: 30 }), (steps) => {
        const original = startDoc();
        let h = createHistory(original);
        for (const step of steps) h = applyStep(h, step);

        while (canUndo(h)) h = undo(h);
        expect(h.present).toEqual(original);
      }),
      { numRuns: 200 },
    );
  });

  it("redoing everything returns to the final document", () => {
    fc.assert(
      fc.property(fc.array(arbStep, { minLength: 1, maxLength: 30 }), (steps) => {
        let h = createHistory(startDoc());
        for (const step of steps) h = applyStep(h, step);
        const final = h.present;

        while (canUndo(h)) h = undo(h);
        while (canRedo(h)) h = redo(h);
        expect(h.present).toEqual(final);
      }),
      { numRuns: 200 },
    );
  });

  it("survives interleaved undo and redo", () => {
    fc.assert(
      fc.property(
        fc.array(arbStep, { minLength: 2, maxLength: 20 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        (steps, moves) => {
          const original = startDoc();
          let h = createHistory(original);
          for (const step of steps) h = applyStep(h, step);
          for (const forward of moves) h = forward ? redo(h) : undo(h);

          while (canUndo(h)) h = undo(h);
          expect(h.present).toEqual(original);
        },
      ),
      { numRuns: 200 },
    );
  });
});
