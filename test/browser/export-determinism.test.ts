import { describe, it, expect, afterEach } from "vitest";
import {
  Input,
  BlobSource,
  ALL_FORMATS,
  VideoSampleSink,
  AudioBufferSink,
} from "mediabunny";
import { exportTimeline, frameTimestamp } from "@/export/export-engine";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "@/export/presets";
import { negotiate } from "@/export/encoder";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { resetLeakCounters, openFrameCount } from "@/media/frame-cache";
import { loadDocument, doc } from "@/stores/project-store";
import { createEmptyDoc, type ProjectDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30, FPS_29_97, framesToSeconds } from "@/lib/timecode";
import { makeTestVideo, readFrameMarker } from "../fixtures/make-media";

/**
 * The export is either exactly right or it is worthless.
 *
 * What it replaces: `canvas.captureStream(0)` fed into a `MediaRecorder`, with
 * `requestFrame()` after each render. Frames were stamped with **wall-clock**
 * time, so a 60-second timeline rendering at 8 fps produced ~225 seconds of
 * slow motion, and the audio — mixed offline, then played into the stream in
 * real time — could not line up with it.
 *
 * So these tests demux what was actually written and check the numbers: the
 * frame count, every timestamp, the frames themselves via their burned-in
 * markers, and the audio's length and content.
 */

const SIZE = 128;
const SOURCE_FRAMES = 90;
const ASSET_ID = "export-fixture";
const TONE_HZ = 1000;

let fixture: Blob | null = null;
async function video(): Promise<Blob> {
  fixture ??= await makeTestVideo({
    fps: 30,
    frames: SOURCE_FRAMES,
    width: SIZE,
    height: SIZE,
    withAudio: true,
    toneHz: TONE_HZ,
  });
  return fixture;
}

async function setUp(
  clipFrames: number,
  build?: (d: ProjectDoc, trackId: string) => void,
): Promise<void> {
  const blob = await video();
  await mediaEngine.openBlob(ASSET_ID, blob);

  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  base.sequence.width = SIZE;
  base.sequence.height = SIZE;
  base.name = "determinism test";
  loadDocument(base);

  const next = doc();
  loadDocument(
    applyTo(next, (d) => {
      edits.upsertAsset(d, {
        id: ASSET_ID,
        name: "fixture.mp4",
        kind: "video",
        size: blob.size,
        durationSec: SOURCE_FRAMES / 30,
        hasAudio: true,
        width: SIZE,
        height: SIZE,
      });
      const track = d.tracks.find((t) => t.kind === "video")!;
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, clipFrames, {
        startFrame: 0,
        mode: "overwrite",
      });
      build?.(d, track.id);
    }),
  );
}

/** A plain structural edit, without going through history. */
function applyTo(base: ProjectDoc, recipe: (d: ProjectDoc) => void): ProjectDoc {
  const copy = structuredClone(base);
  recipe(copy);
  return copy;
}

const SETTINGS: ExportSettings = {
  ...DEFAULT_EXPORT_SETTINGS,
  width: SIZE,
  height: SIZE,
  videoBitrate: 2_000_000,
};

afterEach(() => {
  forgetAllAssets();
  resetLeakCounters();
  loadDocument(createEmptyDoc());
});

/** Every video sample in a written file, in order. */
async function demuxVideo(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("the exported file has no video track");
  return { input, track };
}

describe("frame count and timing", () => {
  it("writes exactly one frame per timeline frame", async () => {
    // The heart of it. 60 frames in, 60 frames out — not 60 divided by how
    // fast the machine happened to render.
    await setUp(60);
    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });

    expect(result.frames).toBe(60);
    expect(result.blob).not.toBeNull();

    const { track } = await demuxVideo(result.blob!);
    const sink = new VideoSampleSink(track);

    let count = 0;
    for await (const sample of sink.samples()) {
      count++;
      sample.close();
    }
    expect(count).toBe(60);
  });

  it("puts every timestamp on an exact frame boundary", async () => {
    await setUp(45);
    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });

    const { track } = await demuxVideo(result.blob!);
    const sink = new VideoSampleSink(track);

    let frame = 0;
    for await (const sample of sink.samples()) {
      const expected = frameTimestamp(frame, FPS_30);
      // One microsecond. Wall-clock stamping missed by tens of milliseconds.
      expect(
        Math.abs(sample.timestamp - expected),
        `frame ${frame}: ${sample.timestamp} vs ${expected}`,
      ).toBeLessThan(1e-6);
      frame++;
      sample.close();
    }
    expect(frame).toBe(45);
  });

  it("reports a duration matching the timeline, not the render time", async () => {
    await setUp(60);
    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });

    expect(result.durationSec).toBeCloseTo(2, 6);

    // The video track's own duration. The container's is longer, because AAC
    // priming makes the audio stream start slightly before zero.
    const { track } = await demuxVideo(result.blob!);
    const duration = await track.computeDuration();
    // Within one frame: containers differ on whether the last frame's
    // duration counts.
    expect(Math.abs(duration - 2)).toBeLessThan(1 / 30 + 1e-3);
  });

  it("keeps 29.97 exact rather than rounding to 30", async () => {
    // Drop-frame rates are where float seconds accumulate visible error.
    await setUp(60);
    const drifting = applyTo(doc(), (d) => {
      d.sequence.frameRate = FPS_29_97;
    });
    loadDocument(drifting);

    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });
    const { track } = await demuxVideo(result.blob!);
    const sink = new VideoSampleSink(track);

    let frame = 0;
    let last = -1;
    for await (const sample of sink.samples()) {
      expect(
        Math.abs(sample.timestamp - frameTimestamp(frame, FPS_29_97)),
      ).toBeLessThan(1e-6);
      expect(sample.timestamp).toBeGreaterThan(last);
      last = sample.timestamp;
      frame++;
      sample.close();
    }
    expect(frame).toBe(60);
    // 60 frames at 30000/1001 is very slightly longer than 2 seconds.
    expect(last).toBeGreaterThan(framesToSeconds(59, FPS_30));
  });
});

describe("picture", () => {
  it("exports the frames the timeline shows, in order", async () => {
    // Each fixture frame carries its own number burned in as binary blocks.
    // Reading them back proves the export walked the timeline rather than
    // sampling whatever the decoder happened to have ready.
    await setUp(30);
    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });

    const { track } = await demuxVideo(result.blob!);
    const sink = new VideoSampleSink(track);
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const read: number[] = [];
    for await (const sample of sink.samples()) {
      ctx.drawImage(sample.toCanvasImageSource(), 0, 0);
      read.push(readFrameMarker(ctx, SIZE, SIZE));
      sample.close();
    }

    expect(read).toHaveLength(30);
    expect(read).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("exports at the requested size, not the sequence size", async () => {
    // The 4K preset used to render at the sequence resolution and upscale,
    // because the compositor was built from `sequence.width/height`.
    await setUp(10);
    const result = await exportTimeline({
      settings: { ...SETTINGS, width: 320, height: 240 },
      doc: doc(),
    });

    const { track } = await demuxVideo(result.blob!);
    expect(track.displayWidth).toBe(320);
    expect(track.displayHeight).toBe(240);
  });

  it("honours a clip's in-point", async () => {
    await setUp(20, (d) => {
      d.tracks.find((t) => t.kind === "video")!.clips[0].inPointFrames = 40;
    });
    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });

    const { track } = await demuxVideo(result.blob!);
    const sink = new VideoSampleSink(track);
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const first = await sink.getSample(0);
    ctx.drawImage(first!.toCanvasImageSource(), 0, 0);
    expect(readFrameMarker(ctx, SIZE, SIZE)).toBe(40);
    first!.close();
  });
});

describe("audio", () => {
  it("is as long as the video and holds the tone", async () => {
    await setUp(60);
    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });

    const input = new Input({
      source: new BlobSource(result.blob!),
      formats: ALL_FORMATS,
    });
    const track = await input.getPrimaryAudioTrack();
    expect(track, "the export should carry audio").not.toBeNull();

    const duration = await track!.computeDuration();
    // Encoder priming makes the decoded stream slightly longer than the
    // timeline; AAC adds around 70ms at the front.
    expect(duration).toBeGreaterThan(1.9);
    expect(duration).toBeLessThan(2.2);

    // Read a window from the middle and confirm it is not silence.
    const sink = new AudioBufferSink(track!);
    let peak = 0;
    for await (const { buffer } of sink.buffers(0.5, 1.0)) {
      const data = buffer.getChannelData(0);
      for (const value of data) peak = Math.max(peak, Math.abs(value));
    }
    expect(peak, "exported audio should not be silent").toBeGreaterThan(0.05);
  });

  it("can be left out", async () => {
    await setUp(20);
    const result = await exportTimeline({
      settings: { ...SETTINGS, includeAudio: false },
      doc: doc(),
    });

    const input = new Input({
      source: new BlobSource(result.blob!),
      formats: ALL_FORMATS,
    });
    expect(await input.getPrimaryAudioTrack()).toBeNull();
    expect(result.codecs.audio).toBeNull();
  });
});

describe("naming and negotiation", () => {
  it("names the file from what was encoded", async () => {
    // A WebM named `.mp4` is what the old dialog produced whenever the
    // requested mime type was unavailable.
    await setUp(5);
    const choice = await negotiate({ ...SETTINGS, container: "webm" });
    const result = await exportTimeline({
      settings: { ...SETTINGS, container: "webm" },
      doc: doc(),
    });

    expect(result.filename.endsWith(".webm")).toBe(true);
    expect(result.codecs.video).toBe(choice!.video);
    expect(result.blob!.type).toContain("webm");
  });

  it("makes a filename out of a project name that is all punctuation", async () => {
    await setUp(5);
    const renamed = applyTo(doc(), (d) => {
      d.name = "///";
    });
    loadDocument(renamed);

    const result = await exportTimeline({ settings: SETTINGS, doc: doc() });
    expect(result.filename).toBe("export.mp4");
  });

  it("refuses an empty timeline with something actionable", async () => {
    loadDocument(createEmptyDoc());
    await expect(exportTimeline({ settings: SETTINGS, doc: doc() })).rejects.toThrow(
      /nothing on the timeline/i,
    );
  });
});

describe("resources", () => {
  it("releases every frame it borrows", async () => {
    // A leak here is invisible until a long export exhausts the decoder pool.
    await setUp(40);
    resetLeakCounters();
    await exportTimeline({ settings: SETTINGS, doc: doc() });

    // Export owns its decoders and disposes them when it finishes, so
    // everything it opened is closed by the time it returns. A borrowed frame
    // that was never released would survive that, which is the leak this
    // catches.
    expect(openFrameCount()).toBe(0);
  });

  it("stops when cancelled", async () => {
    await setUp(120);
    resetLeakCounters();
    const controller = new AbortController();
    let seen = 0;

    const running = exportTimeline({
      settings: SETTINGS,
      doc: doc(),
      signal: controller.signal,
      onProgress: (p) => {
        seen = Math.max(seen, p.frame);
        if (p.phase === "rendering" && p.frame >= 10) controller.abort();
      },
    });

    await expect(running).rejects.toThrow(/cancelled/i);
    expect(seen).toBeLessThan(120);
    // Abandoning mid-render must not strand the frames already borrowed.
    expect(openFrameCount()).toBe(0);
  });
});

describe("streaming to a file", () => {
  /**
   * A sparse file assembled from positioned writes.
   *
   * The muxer does not write front to back: MP4 patches its header once the
   * sizes are known. An append-only sink would therefore produce a corrupt
   * file that still looks plausible, so the test reassembles by position and
   * then demuxes what it got.
   */
  function positionedSink(): {
    stream: WritableStream<{ type: "write"; data: Uint8Array; position: number }>;
    result: () => Uint8Array<ArrayBuffer>;
  } {
    let bytes = new Uint8Array(new ArrayBuffer(0));

    const stream = new WritableStream<{
      type: "write";
      data: Uint8Array;
      position: number;
    }>({
      write(chunk) {
        const end = chunk.position + chunk.data.byteLength;
        if (end > bytes.byteLength) {
          const grown = new Uint8Array(new ArrayBuffer(end));
          grown.set(bytes);
          bytes = grown;
        }
        bytes.set(chunk.data, chunk.position);
      },
    });

    return { stream, result: () => bytes };
  }

  it("writes a valid file without ever holding it in memory", async () => {
    // The reason this path exists: a 4K feature-length export cannot be a
    // Blob. Correctness of the positioned writes is what makes it usable.
    await setUp(30);
    const sink = positionedSink();

    const result = await exportTimeline({
      settings: SETTINGS,
      doc: doc(),
      writable: sink.stream,
    });

    // Nothing was buffered for the caller — that is the point.
    expect(result.blob).toBeNull();
    expect(result.frames).toBe(30);

    const written = new Blob([sink.result()], { type: "video/mp4" });
    expect(written.size).toBeGreaterThan(1000);

    const { track } = await demuxVideo(written);
    const sink2 = new VideoSampleSink(track);
    let count = 0;
    for await (const sample of sink2.samples()) {
      count++;
      sample.close();
    }
    expect(count, "the streamed file should hold every frame").toBe(30);
  });
});
