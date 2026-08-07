import { describe, it, expect, afterEach } from "vitest";
import {
  createCompositor,
  renderFrame,
  disposeCompositor,
} from "@/renderer/compositor";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { resetLeakCounters } from "@/media/frame-cache";
import { loadDocument, doc, applyEdit } from "@/stores/project-store";
import { createEmptyDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { makeTestVideo, readFrameMarker } from "../fixtures/make-media";

/**
 * Does the compositor actually put the decoded frame on screen?
 *
 * Reads back the composite framebuffer rather than the canvas, because the
 * default drawing buffer is created with `preserveDrawingBuffer: false` and is
 * cleared as soon as the browser composites — so reading it from a later task
 * always returns black, whatever was drawn.
 */

const FPS = 30;
const FRAMES = 30;
const ASSET_ID = "compositor-fixture";

let fixture: Blob | null = null;
async function video(): Promise<Blob> {
  // Large enough that the marker blocks survive being scaled into the
  // compositor's letterboxed output.
  fixture ??= await makeTestVideo({
    fps: FPS,
    frames: FRAMES,
    width: 256,
    height: 256,
  });
  return fixture;
}

function makeCanvas(width = 256, height = 256): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Reads the composite framebuffer, flipped back to top-down. */
function readComposite(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  width: number,
  height: number,
): ImageData {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // GL reads bottom-up; ImageData is top-down.
  const flipped = new Uint8ClampedArray(pixels.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * rowBytes;
    flipped.set(pixels.subarray(from, from + rowBytes), y * rowBytes);
  }
  return new ImageData(flipped, width, height);
}

async function setUpTimeline(): Promise<void> {
  const blob = await video();
  await mediaEngine.openBlob(ASSET_ID, blob);

  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  base.sequence.width = 256;
  base.sequence.height = 256;
  loadDocument(base);

  applyEdit("setup", (d) => {
    edits.upsertAsset(d, {
      id: ASSET_ID,
      name: "fixture.mp4",
      kind: "video",
      size: blob.size,
      durationSec: FRAMES / FPS,
      hasAudio: false,
      width: 256,
      height: 256,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
      startFrame: 0,
      mode: "overwrite",
    });
  });
}

afterEach(() => {
  forgetAllAssets();
  resetLeakCounters();
  loadDocument(createEmptyDoc());
});

describe("compositor", () => {
  it("draws a decoded frame rather than black", async () => {
    await setUpTimeline();
    const canvas = makeCanvas();
    const comp = createCompositor(canvas);
    expect(comp).not.toBeNull();

    const clip = doc().tracks.find((t) => t.kind === "video")!.clips[0];
    // Warm the cache: the render path never waits, by design.
    (await mediaEngine.getExact(doc(), clip, 10))?.release();

    renderFrame(comp!, 10);

    const image = readComposite(comp!.gl, comp!.compositeBuffer.fbo, 256, 256);
    const anyLit = [...image.data].some((v, i) => i % 4 !== 3 && v > 16);
    expect(anyLit, "composite should not be entirely black").toBe(true);

    disposeCompositor(comp!);
  });

  it("draws the frame the playhead is on", async () => {
    await setUpTimeline();
    const canvas = makeCanvas();
    const comp = createCompositor(canvas)!;
    const clip = doc().tracks.find((t) => t.kind === "video")!.clips[0];
    const results: { frame: number; asRead: number; flipped: number }[] = [];

    for (const frame of [3, 11, 24]) {
      (await mediaEngine.getExact(doc(), clip, frame))?.release();
      renderFrame(comp, frame);

      const image = readComposite(comp.gl, comp.compositeBuffer.fbo, 256, 256);
      const readback = new OffscreenCanvas(256, 256);
      const ctx = readback.getContext("2d", { willReadFrequently: true })!;
      ctx.putImageData(image, 0, 0);

      // Read both orientations: the compositor's quad bakes a V-flip and the
      // GL read is bottom-up, so which way up the composite lands is exactly
      // the Y-flip confusion the render graph rewrite is due to settle.
      const asRead = readFrameMarker(ctx, 256, 256);
      ctx.save();
      ctx.scale(1, -1);
      ctx.drawImage(readback, 0, -256);
      ctx.restore();
      const flipped = readFrameMarker(ctx, 256, 256);
      results.push({ frame, asRead, flipped });
    }

    // Whichever way up the composite lands, one orientation must read back
    // the exact frame the playhead is on for every sample.
    const asReadMatches = results.every((r) => r.asRead === r.frame);
    const flippedMatches = results.every((r) => r.flipped === r.frame);
    expect(
      asReadMatches || flippedMatches,
      `frame markers did not read back: ${JSON.stringify(results)}`,
    ).toBe(true);

    disposeCompositor(comp);
  });

  it("renders nothing rather than throwing when a frame is not yet decoded", async () => {
    await setUpTimeline();
    const canvas = makeCanvas();
    const comp = createCompositor(canvas)!;

    // Nothing warmed: the pass must skip the layer, not wait or throw.
    expect(() => renderFrame(comp, 5)).not.toThrow();

    disposeCompositor(comp);
  });

  it("is synchronous", () => {
    // The old renderFrame was async and was called without await from the rAF
    // loop, so several renders overlapped and stomped shared GL state. Being
    // synchronous is what makes that impossible.
    const canvas = makeCanvas();
    const comp = createCompositor(canvas)!;
    const result = renderFrame(comp, 0) as unknown;
    expect(result).toBeUndefined();
    disposeCompositor(comp);
  });
});
