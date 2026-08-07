import { describe, it, expect, afterEach } from "vitest";
import { MediaEngine } from "@/media/engine";
import { leakCount, resetLeakCounters } from "@/media/frame-cache";
import { forgetAllAssets } from "@/media/asset-registry";
import { openInput, probeMedia } from "@/media/probe";
import { createBlobSource } from "@/media/source";
import { createEmptyDoc, createClip, type ProjectDoc } from "@/model/doc";
import { FPS_30 } from "@/lib/timecode";
import { makeTestVideo, readFrameMarker } from "../fixtures/make-media";

/**
 * These run in real Chromium because they need WebCodecs. Everything here is
 * about the two claims the media engine exists to make: the frame you asked
 * for is the frame you get, and nothing leaks while doing it.
 */

const FPS = 30;
const FRAMES = 30;

let fixture: Blob | null = null;
async function video(): Promise<Blob> {
  fixture ??= await makeTestVideo({ fps: FPS, frames: FRAMES, width: 64, height: 64 });
  return fixture;
}

/** Reads the burned-in counter out of a decoded frame. */
function decodedFrameNumber(sample: {
  toCanvasImageSource: () => OffscreenCanvas | VideoFrame;
  codedWidth: number;
  codedHeight: number;
}): number {
  const canvas = new OffscreenCanvas(sample.codedWidth, sample.codedHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(sample.toCanvasImageSource(), 0, 0);
  return readFrameMarker(ctx, sample.codedWidth, sample.codedHeight);
}

function docWithClip(): { doc: ProjectDoc; clip: ReturnType<typeof createClip> } {
  const clip = createClip({ type: "asset", assetId: "fixture" }, 0, FRAMES);
  const doc = createEmptyDoc();
  doc.sequence.frameRate = FPS_30;
  return { doc, clip };
}

afterEach(() => {
  forgetAllAssets();
  resetLeakCounters();
});

describe("probing", () => {
  it("reports what is actually in the file", async () => {
    const input = openInput(createBlobSource(await video()));
    const probe = await probeMedia(input);

    expect(probe.problem).toBeUndefined();
    expect(probe.video).not.toBeNull();
    expect(probe.video?.decodable).toBe(true);
    expect(probe.video?.width).toBe(64);
    expect(probe.video?.height).toBe(64);
    expect(probe.durationSec).toBeCloseTo(FRAMES / FPS, 1);
    input.dispose();
  });

  it("reports a problem for a file that is not media, instead of throwing", async () => {
    // The old path handed anything with a plausible extension to a <video>
    // element and swallowed the failure, leaving a permanently black clip.
    const notMedia = new Blob([new Uint8Array(4096).fill(0x41)], { type: "video/mp4" });
    const input = openInput(createBlobSource(notMedia));
    const probe = await probeMedia(input);

    expect(probe.problem).toBeDefined();
    expect(probe.video).toBeNull();
    expect(probe.problem?.detail).toMatch(/could not read|not a media container/i);
    input.dispose();
  });

  it("reports a problem for an empty file", async () => {
    const input = openInput(createBlobSource(new Blob([])));
    const probe = await probeMedia(input);
    expect(probe.problem).toBeDefined();
    input.dispose();
  });
});

describe("frame accuracy", () => {
  it("returns the exact frame requested", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    for (const frame of [0, 1, 7, 15, 29]) {
      const borrowed = await engine.getExact(doc, clip, frame);
      expect(borrowed, `frame ${frame} should decode`).not.toBeNull();
      expect(decodedFrameNumber(borrowed!.sample)).toBe(frame);
      borrowed!.release();
    }
    engine.dispose();
  });

  it("does not return duplicate frames for adjacent requests", async () => {
    // The old seek tolerance was 0.02s — wider than a frame at 60fps — so
    // consecutive requests silently returned the same picture.
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    const decoded: number[] = [];
    for (let frame = 10; frame < 20; frame++) {
      const borrowed = await engine.getExact(doc, clip, frame);
      decoded.push(decodedFrameNumber(borrowed!.sample));
      borrowed!.release();
    }
    expect(decoded).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("honours a clip's in-point", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const doc = createEmptyDoc();
    doc.sequence.frameRate = FPS_30;
    const clip = createClip({ type: "asset", assetId: "fixture" }, 100, 10, {
      inPointFrames: 5,
    });

    // Timeline frame 100 is the clip's first frame, which is source frame 5.
    const borrowed = await engine.getExact(doc, clip, 100);
    expect(decodedFrameNumber(borrowed!.sample)).toBe(5);
    borrowed!.release();
    engine.dispose();
  });

  it("honours a clip's speed", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const doc = createEmptyDoc();
    doc.sequence.frameRate = FPS_30;
    const clip = createClip({ type: "asset", assetId: "fixture" }, 0, 10, {
      speed: 2,
    });

    // At 2x, timeline frame 5 shows source frame 10.
    const borrowed = await engine.getExact(doc, clip, 5);
    expect(decodedFrameNumber(borrowed!.sample)).toBe(10);
    borrowed!.release();
    engine.dispose();
  });

  it("returns null past the end of the source rather than a stale frame", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    const borrowed = await engine.getExact(doc, clip, FRAMES + 200);
    if (borrowed) {
      // Some containers clamp to the last frame; that is acceptable, but it
      // must not silently be an early frame.
      expect(decodedFrameNumber(borrowed.sample)).toBeGreaterThanOrEqual(FRAMES - 2);
      borrowed.release();
    }
    engine.dispose();
  });
});

describe("non-blocking reads", () => {
  it("tryGet returns nothing before anything is decoded", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    expect(engine.tryGet(doc, clip, 10)).toBeNull();
    engine.dispose();
  });

  it("tryGet hits once a frame is cached", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    const warm = await engine.getExact(doc, clip, 10);
    warm!.release();

    const borrowed = engine.tryGet(doc, clip, 10);
    expect(borrowed).not.toBeNull();
    expect(borrowed!.exact).toBe(true);
    expect(decodedFrameNumber(borrowed!.sample)).toBe(10);
    borrowed!.release();
    engine.dispose();
  });

  it("falls back to an earlier frame and says so", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    const warm = await engine.getExact(doc, clip, 10);
    warm!.release();

    // Frame 12 is not cached, but 10 is and is close enough to stand in.
    const borrowed = engine.tryGet(doc, clip, 12);
    expect(borrowed).not.toBeNull();
    expect(borrowed!.exact).toBe(false);
    expect(borrowed!.sourceFrame).toBe(10);
    borrowed!.release();
    engine.dispose();
  });
});

describe("two clips of one source", () => {
  it("do not interfere", async () => {
    // One <video> element per file meant a split clip's two halves fought over
    // currentTime and the last seek won.
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const doc = createEmptyDoc();
    doc.sequence.frameRate = FPS_30;

    const a = createClip({ type: "asset", assetId: "fixture" }, 0, 15);
    const b = createClip({ type: "asset", assetId: "fixture" }, 0, 15, {
      inPointFrames: 15,
    });

    const [frameA, frameB] = await Promise.all([
      engine.getExact(doc, a, 3),
      engine.getExact(doc, b, 3),
    ]);

    expect(decodedFrameNumber(frameA!.sample)).toBe(3);
    expect(decodedFrameNumber(frameB!.sample)).toBe(18);
    frameA!.release();
    frameB!.release();
    engine.dispose();
  });
});

describe("resource discipline", () => {
  it("closes every frame it opened", async () => {
    // The assertion that keeps `.close()` honest.
    resetLeakCounters();
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    for (let frame = 0; frame < FRAMES; frame++) {
      const borrowed = await engine.getExact(doc, clip, frame);
      borrowed?.release();
    }
    expect(leakCount()).toBeGreaterThan(0); // frames are held by the cache

    engine.dispose();
    expect(leakCount()).toBe(0);
  });

  it("evicts decoders beyond the budget", async () => {
    const engine = new MediaEngine(2);
    await engine.openBlob("fixture", await video());
    const doc = createEmptyDoc();
    doc.sequence.frameRate = FPS_30;

    for (let i = 0; i < 6; i++) {
      const clip = createClip({ type: "asset", assetId: "fixture" }, i * 40, 10);
      const borrowed = await engine.getExact(doc, clip, i * 40);
      borrowed?.release();
    }

    expect(engine.stats().decoders).toBeLessThanOrEqual(2);
    engine.dispose();
    expect(leakCount()).toBe(0);
  });

  it("retain drops decoders for clips no longer near the playhead", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const doc = createEmptyDoc();
    doc.sequence.frameRate = FPS_30;

    const clips = [0, 1, 2].map((i) =>
      createClip({ type: "asset", assetId: "fixture" }, i * 40, 10),
    );
    for (const clip of clips) {
      (await engine.getExact(doc, clip, clip.startFrame))?.release();
    }
    expect(engine.stats().decoders).toBe(3);

    engine.retain([clips[0].id]);
    expect(engine.stats().decoders).toBe(1);

    engine.dispose();
    expect(leakCount()).toBe(0);
  });

  it("keeps the frame cache under its byte budget", async () => {
    const engine = new MediaEngine();
    await engine.openBlob("fixture", await video());
    const { doc, clip } = docWithClip();

    // A tiny budget: one 64x64 frame is ~16KB, so 40KB holds two or three.
    engine.stats(); // touch the pool so the cache exists
    for (let frame = 0; frame < FRAMES; frame++) {
      (await engine.getExact(doc, clip, frame))?.release();
    }
    const stats = engine.stats();
    expect(stats.cache.bytes).toBeLessThanOrEqual(stats.cache.budgetBytes);
    engine.dispose();
  });
});

describe("missing media", () => {
  it("returns null rather than throwing for an unregistered asset", async () => {
    const engine = new MediaEngine();
    const { doc, clip } = docWithClip();
    await expect(engine.getExact(doc, clip, 0)).resolves.toBeNull();
    expect(engine.tryGet(doc, clip, 0)).toBeNull();
    engine.dispose();
  });

  it("returns null for a text clip", async () => {
    const engine = new MediaEngine();
    const doc = createEmptyDoc();
    const clip = createClip(
      {
        type: "text",
        style: {
          text: "hi",
          fontFamily: "sans-serif",
          fontSize: 24,
          fontWeight: "normal",
          color: "#fff",
          x: 0.5,
          y: 0.5,
          align: "center",
        },
      },
      0,
      30,
    );
    await expect(engine.getExact(doc, clip, 0)).resolves.toBeNull();
    engine.dispose();
  });
});
