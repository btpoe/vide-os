import { describe, it, expect, beforeEach } from "vitest";
import {
  writeRevision,
  listRevisions,
  readRevision,
  clearRevisions,
  recoveryOffer,
  markSessionOpen,
  markSessionClosed,
  markSavedToFile,
  wasUnclean,
  MAX_REVISIONS,
} from "@/lib/autosave";
import { platform } from "@/platform";
import { createEmptyDoc, type ProjectDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { create } from "mutative";
import { FPS_30 } from "@/lib/timecode";

/**
 * Autosave against real OPFS.
 *
 * The old autosave wrote the document to localStorage, whose ~5 MB quota
 * throws on overflow — caught, warned to a console nobody reads, and silently
 * not saved from then on. A project with a few keyframed effects passes that
 * ceiling easily. This runs in a browser because the whole point is the
 * storage backend, and mocking it would test nothing.
 */

async function wipe(): Promise<void> {
  const store = await platform.cache.open("autosave");
  await store.clear();
}

function docNamed(name: string, clips = 1): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    d.name = name;
    d.sequence.frameRate = FPS_30;
    edits.upsertAsset(d, {
      id: "a",
      name: "a.mp4",
      kind: "video",
      size: 1,
      durationSec: 100,
      hasAudio: false,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    for (let i = 0; i < clips; i++) {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: i * 30,
        mode: "overwrite",
      });
    }
  });
}

beforeEach(async () => {
  await wipe();
});

describe("revisions", () => {
  it("round-trips a document", async () => {
    await writeRevision(docNamed("Round trip", 3));

    const revisions = await listRevisions();
    expect(revisions).toHaveLength(1);
    expect(revisions[0].projectName).toBe("Round trip");

    const restored = await readRevision(revisions[0].key);
    expect(restored?.name).toBe("Round trip");
    expect(restored?.tracks.find((t) => t.kind === "video")?.clips).toHaveLength(3);
  });

  it("keeps a document far larger than localStorage would hold", async () => {
    // The ceiling that made the old autosave fail silently is about 5 MB.
    const heavy = create(docNamed("Heavy"), (d) => {
      const clip = d.tracks.find((t) => t.kind === "video")!.clips[0];
      clip.opacity = {
        value: 1,
        keys: Array.from({ length: 40_000 }, (_, i) => ({
          id: `k${i}`,
          timeFrames: i,
          value: i / 40_000,
          interp: "linear" as const,
        })),
      };
    });

    await writeRevision(heavy);
    const revisions = await listRevisions();
    expect(revisions[0].bytes).toBeGreaterThan(1_000_000);

    const restored = await readRevision(revisions[0].key);
    expect(
      restored?.tracks.find((t) => t.kind === "video")?.clips[0].opacity.keys,
    ).toHaveLength(40_000);
  });

  it("lists newest first", async () => {
    for (const name of ["first", "second", "third"]) {
      await writeRevision(docNamed(name));
      // Keys carry their timestamp, so distinct writes need distinct
      // milliseconds.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const names = (await listRevisions()).map((r) => r.projectName);
    expect(names).toEqual(["third", "second", "first"]);
  });

  it("keeps only the most recent few", async () => {
    for (let i = 0; i < MAX_REVISIONS + 5; i++) {
      await writeRevision(docNamed(`rev ${i}`));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const revisions = await listRevisions();
    expect(revisions).toHaveLength(MAX_REVISIONS);
    // The ones it kept are the newest, not the first it happened to write.
    expect(revisions[0].projectName).toBe(`rev ${MAX_REVISIONS + 4}`);
  });

  it("skips a corrupt revision rather than hiding the good ones", async () => {
    // A crash mid-write leaves a partial file; one bad entry must not make
    // recovery report nothing at all.
    await writeRevision(docNamed("good"));
    const store = await platform.cache.open("autosave");
    await store.set("rev-9999999999999", new TextEncoder().encode("{ not json"));

    const revisions = await listRevisions();
    expect(revisions.map((r) => r.projectName)).toEqual(["good"]);
  });

  it("returns null for a revision that is gone", async () => {
    expect(await readRevision("rev-1")).toBeNull();
  });
});

describe("crash detection", () => {
  it("reports a session that never closed", async () => {
    await markSessionOpen();
    expect(await wasUnclean()).toBe(true);
  });

  it("reports nothing after a clean close", async () => {
    await markSessionOpen();
    await markSessionClosed();
    expect(await wasUnclean()).toBe(false);
  });
});

describe("what to offer at launch", () => {
  it("offers nothing when there is nothing saved", async () => {
    expect(await recoveryOffer()).toBeNull();
  });

  it("stays quiet when the autosave is older than the file", async () => {
    // Nothing to add, and prompting anyway is how people learn to dismiss the
    // dialog without reading it.
    await writeRevision(docNamed("saved"));
    await markSessionClosed();
    await markSavedToFile(Date.now() + 5000);

    expect(await recoveryOffer()).toBeNull();
  });

  it("offers when work is newer than the last save to a file", async () => {
    await markSavedToFile(Date.now() - 5000);
    await writeRevision(docNamed("newer"));
    await markSessionClosed();

    const offer = await recoveryOffer();
    expect(offer?.newerThanFile).toBe(true);
    expect(offer?.revision.projectName).toBe("newer");
  });

  it("flags a crash even when the file is newer", async () => {
    await writeRevision(docNamed("mid-edit"));
    await markSavedToFile(Date.now() + 5000);
    await markSessionOpen();

    const offer = await recoveryOffer();
    expect(offer?.afterCrash).toBe(true);
  });

  it("carries every revision, so an older one can be chosen", async () => {
    // The newest autosave may be the state that caused the crash.
    for (const name of ["older", "newer"]) {
      await writeRevision(docNamed(name));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await markSessionOpen();

    const offer = await recoveryOffer();
    expect(offer?.all.map((r) => r.projectName)).toEqual(["newer", "older"]);
  });
});

describe("discarding", () => {
  it("removes every revision", async () => {
    await writeRevision(docNamed("a"));
    await writeRevision(docNamed("b"));
    await clearRevisions();
    expect(await listRevisions()).toEqual([]);
  });

  it("leaves the session and clean markers alone", async () => {
    // They are not revisions, and clearing them would make the next launch
    // misreport what happened.
    await markSessionOpen();
    await writeRevision(docNamed("a"));
    await clearRevisions();
    expect(await wasUnclean()).toBe(true);
  });
});
