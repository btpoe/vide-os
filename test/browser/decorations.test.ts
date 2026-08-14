import { describe, it, expect, beforeAll, afterEach } from "vitest";
import WaveformWorker from "../../src/media/waveform-worker?worker";
import type { WaveformResponse } from "@/media/waveform-worker";
import {
  clearAllWaveforms,
  getWaveform,
  purgeWaveformCache,
  resetWaveformWorker,
} from "@/lib/waveform-cache";
import {
  clearAllFilmstrips,
  getFilmstrip,
  posterFrame,
  purgeFilmstripCache,
  tileIndexAt,
} from "@/lib/clip-thumbnails";
import {
  BASE_SAMPLES_PER_BUCKET,
  deserialisePyramid,
  peaksForRange,
} from "@/lib/waveform";
import { makeTestVideo, readFrameMarker } from "../fixtures/make-media";

/**
 * The timeline decorations, generated from real media.
 *
 * These are the two generators Phase 2 was supposed to rewrite and did not: a
 * waveform fixed at 200 peaks per file however long it was, and a thumbnail made
 * by seeking a `<video>` element. Both claims worth testing are about real files
 * — that the peak resolution scales with the media, and that the strip shows
 * successive frames of it — so nothing here is stubbed.
 */

const WIDTH = 128;
const HEIGHT = 72;
const FPS = 30;
const FRAMES = 60;

/** Quiet for the first half, loud for the second. */
const envelope = (seconds: number) => (seconds < 1 ? 0.05 : 0.9);

let withAudio: Blob;
let silent: Blob;

beforeAll(async () => {
  [withAudio, silent] = await Promise.all([
    makeTestVideo({
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      frames: FRAMES,
      withAudio: true,
      toneGain: envelope,
    }),
    makeTestVideo({ width: WIDTH, height: HEIGHT, fps: FPS, frames: FRAMES }),
  ]);

  // OPFS outlives the page, so a second run of this file would otherwise read
  // the previous run's entries and never exercise the generators at all.
  await purgeWaveformCache();
  await purgeFilmstripCache();
}, 120_000);

afterEach(() => {
  clearAllWaveforms();
  clearAllFilmstrips();
});

/** Reads the burned-in frame number out of one tile of a sprite sheet. */
async function markerInTile(
  url: string,
  index: number,
  tileWidth: number,
  tileHeight: number,
): Promise<number> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  try {
    const canvas = new OffscreenCanvas(tileWidth, tileHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D context");
    ctx.drawImage(
      bitmap,
      index * tileWidth,
      0,
      tileWidth,
      tileHeight,
      0,
      0,
      tileWidth,
      tileHeight,
    );
    return readFrameMarker(ctx, tileWidth, tileHeight);
  } finally {
    bitmap.close();
  }
}

describe("waveform peaks", () => {
  it("scales its resolution to the length of the file", async () => {
    const pyramid = await getWaveform("wave-resolution", withAudio);
    expect(pyramid).not.toBeNull();

    const buckets = pyramid!.levels[0].pairs.length >> 1;
    const expected = Math.ceil(pyramid!.totalSamples / BASE_SAMPLES_PER_BUCKET);
    expect(buckets).toBe(expected);

    // The defect this replaces: 200 peaks whatever the duration, so a bar was
    // eighteen seconds on an hour-long recording. Two seconds at 48kHz is 750
    // buckets, and an hour would be 1.35 million.
    expect(buckets).toBeGreaterThan(700);
    expect(pyramid!.sampleRate).toBe(48000);

    // Two seconds of video, and slightly more than two seconds of audio: AAC
    // carries encoder priming and pads to a frame boundary, so the track decodes
    // longer than it was encoded (findings 3.7). The peaks cover the audio, so
    // the bound is one-sided.
    const durationSec = pyramid!.totalSamples / pyramid!.sampleRate;
    expect(durationSec).toBeGreaterThanOrEqual(FRAMES / FPS);
    expect(durationSec).toBeLessThan(FRAMES / FPS + 0.2);
  }, 60_000);

  it("finds the envelope the fixture was encoded with", async () => {
    const pyramid = await getWaveform("wave-envelope", withAudio);
    expect(pyramid).not.toBeNull();

    // Twenty columns over the two seconds. Not two: a column reads every bucket
    // it overlaps at the chosen level, and at one column per second the buckets
    // are coarse enough that the first column catches the start of the loud half.
    // The envelope is never understated, which is the property that matters for
    // drawing; it can be a fraction of a column wide.
    const columns = peaksForRange(pyramid!, 0, 2, 20);
    for (let i = 0; i < 8; i++) expect(columns.max[i]).toBeLessThan(0.2);
    for (let i = 12; i < 20; i++) expect(columns.max[i]).toBeGreaterThan(0.7);

    // Min and max rather than one mirrored magnitude, so an asymmetric signal
    // draws as itself. A sine is symmetric, so these should mirror.
    expect(columns.min[15]).toBeCloseTo(-columns.max[15], 1);
  }, 60_000);

  it("reports nothing for a file with no audio, and does not keep asking", async () => {
    expect(await getWaveform("wave-silent", silent)).toBeNull();
    // Second call must not re-demux: the file has no audio track, which is a
    // property of the file and not a transient failure.
    expect(await getWaveform("wave-silent", silent)).toBeNull();
  }, 60_000);

  it("comes back from OPFS on the second launch rather than decoding again", async () => {
    const first = await getWaveform("wave-cached", withAudio);
    expect(first).not.toBeNull();

    // Forget the in-memory copy, which is what a reload does, and ask again with
    // bytes that could not possibly be analysed. Anything that comes back came
    // from the cache — the tier the old in-memory-only `Map` did not have.
    clearAllWaveforms();
    const garbage = new Blob([new Uint8Array(64)], { type: "video/mp4" });
    const second = await getWaveform("wave-cached", garbage);

    expect(second).not.toBeNull();
    expect(second!.totalSamples).toBe(first!.totalSamples);
    expect([...second!.levels[0].pairs]).toEqual([...first!.levels[0].pairs]);
  }, 60_000);

  it("analyses in a worker", async () => {
    // Driven directly, because "it ran off the main thread" is not observable
    // from the result. What is observable is that the worker module loads,
    // decodes through WebCodecs, and posts back peaks that parse.
    resetWaveformWorker();
    const worker = new WaveformWorker();
    try {
      const response = await new Promise<WaveformResponse>((resolve, reject) => {
        worker.addEventListener("message", (event: MessageEvent<WaveformResponse>) =>
          resolve(event.data),
        );
        worker.addEventListener("error", () => reject(new Error("worker failed")));
        worker.postMessage({ id: 7, blob: withAudio });
      });

      expect(response.id).toBe(7);
      expect(response.error).toBeUndefined();
      expect(response.bytes).toBeDefined();

      const pyramid = deserialisePyramid(response.bytes!);
      expect(pyramid).not.toBeNull();
      expect(peaksForRange(pyramid!, 1, 2, 1).max[0]).toBeGreaterThan(0.7);
    } finally {
      worker.terminate();
    }
  }, 60_000);
});

describe("filmstrips", () => {
  it("shows successive frames of the source, not one frame stretched", async () => {
    const strip = await getFilmstrip("strip-frames", withAudio, "video");
    expect(strip).not.toBeNull();
    expect(strip!.tiles).toBeGreaterThanOrEqual(4);
    expect(strip!.tileHeight).toBe(45);

    const markers: number[] = [];
    for (let i = 0; i < strip!.tiles; i++) {
      markers.push(
        await markerInTile(strip!.url, i, strip!.tileWidth, strip!.tileHeight),
      );
    }

    // The fixture burns its frame number into every frame, so this is the whole
    // claim in one assertion: each tile is a later frame than the one before.
    for (let i = 1; i < markers.length; i++) {
      expect(markers[i]).toBeGreaterThan(markers[i - 1]);
    }
    expect(markers[0]).toBeLessThan(FRAMES / 2);
    expect(markers[markers.length - 1]).toBeGreaterThan(FRAMES / 2);
  }, 60_000);

  it("indexes tiles by source time, so a trim reveals different frames", async () => {
    const strip = await getFilmstrip("strip-index", withAudio, "video");
    expect(strip).not.toBeNull();

    expect(tileIndexAt(strip!, 0)).toBe(0);
    expect(tileIndexAt(strip!, strip!.secondsPerTile * 1.5)).toBe(1);
    // Past the end of the media holds the last frame rather than wrapping to the
    // first, which would read as the clip looping.
    expect(tileIndexAt(strip!, 1e6)).toBe(strip!.tiles - 1);
    expect(tileIndexAt(strip!, -5)).toBe(0);
  }, 60_000);

  it("decodes without a video element anywhere", async () => {
    const before = document.querySelectorAll("video").length;
    await getFilmstrip("strip-no-video", withAudio, "video");
    await posterFrame(withAudio);
    // `<video>` elements leak toward Chrome's decoder cap and cannot seek
    // accurately; Phase 3 deleted every other use of them and these two were
    // the last. If one comes back, this is where it shows up.
    expect(document.querySelectorAll("video").length).toBe(before);
  }, 60_000);

  it("comes back from OPFS on the second launch", async () => {
    const first = await getFilmstrip("strip-cached", withAudio, "video");
    expect(first).not.toBeNull();

    clearAllFilmstrips();
    const garbage = new Blob([new Uint8Array(64)], { type: "video/mp4" });
    const second = await getFilmstrip("strip-cached", garbage, "video");

    expect(second).not.toBeNull();
    expect(second!.tiles).toBe(first!.tiles);
    expect(second!.tileWidth).toBe(first!.tileWidth);
    expect(second!.secondsPerTile).toBeCloseTo(first!.secondsPerTile, 6);
  }, 60_000);

  it("makes a poster frame for the media pool", async () => {
    const url = await posterFrame(withAudio, 45);
    expect(url).not.toBeNull();

    const bitmap = await createImageBitmap(await (await fetch(url!)).blob());
    try {
      expect(bitmap.height).toBe(45);
      expect(bitmap.width).toBe(80);
    } finally {
      bitmap.close();
      URL.revokeObjectURL(url!);
    }
  }, 60_000);
});
