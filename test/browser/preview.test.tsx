import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render } from "solid-js/web";
import { createRoot } from "solid-js";
import PreviewPanel from "@/panels/PreviewPanel";
import { loadDocument, applyEdit, setPlayheadFrame } from "@/stores/project-store";
import { clock, seekToFrame, play, pause } from "@/playback/transport";
import { startPreview } from "@/playback/scheduler";
import {
  createCompositor,
  disposeCompositor,
  currentAccumulator,
  type Compositor,
} from "@/renderer/compositor";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { resetLeakCounters } from "@/media/frame-cache";
import { createEmptyDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { makeTestVideo, readFrameMarker } from "../fixtures/make-media";

/**
 * The preview, driven the way a person drives it.
 *
 * Every other renderer test warms the frame cache by awaiting `getExact`
 * itself before rendering — which is exactly the step the application does not
 * do. These start the real scheduler, put a clip on the timeline, move the
 * playhead the way the timeline does, and look at the result. That is the
 * difference between "the compositor works" and "the preview works".
 *
 * Pixels come from the composite framebuffer, never from the canvas: the
 * drawing buffer is created with `preserveDrawingBuffer: false` and is cleared
 * as soon as the browser composites, so reading the canvas from a later task
 * returns black whatever was drawn. Measuring that instead is how this test
 * first "confirmed" a bug that was partly its own.
 */

const SIZE = 128;
const FRAMES = 60;
const ASSET_ID = "preview-fixture";

let fixture: Blob | null = null;
async function video(): Promise<Blob> {
  fixture ??= await makeTestVideo({
    fps: 30,
    frames: FRAMES,
    width: SIZE,
    height: SIZE,
  });
  return fixture;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
let compositor: Compositor | null = null;
let scheduler: { stop: () => void } | null = null;

async function setUp(): Promise<void> {
  const blob = await video();
  await mediaEngine.openBlob(ASSET_ID, blob);

  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  base.sequence.width = SIZE;
  base.sequence.height = SIZE;
  loadDocument(base);

  applyEdit("setup", (d) => {
    edits.upsertAsset(d, {
      id: ASSET_ID,
      name: "fixture.mp4",
      kind: "video",
      size: blob.size,
      durationSec: FRAMES / 30,
      hasAudio: false,
      width: SIZE,
      height: SIZE,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
      startFrame: 0,
      mode: "overwrite",
    });
  });
}

/** The scheduler running against a compositor this test can read back. */
function startScheduler(): Compositor {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const comp = createCompositor(canvas)!;
  compositor = comp;
  dispose = createRoot((disposeRoot) => {
    scheduler = startPreview(comp);
    return disposeRoot;
  });
  return comp;
}

/** Waits until the preview settles on a frame, or gives up. */
async function settle(comp: Compositor, attempts = 60): Promise<ImageData> {
  let last = readComposite(comp);
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    last = readComposite(comp);
    if (isLit(last)) return last;
  }
  return last;
}

/** Waits for the preview to show a particular frame, or gives up. */
async function settleOn(
  comp: Compositor,
  frame: number,
  attempts = 60,
): Promise<number> {
  let seen = -1;
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const image = readComposite(comp);
    if (!isLit(image)) continue;
    seen = markerOf(image);
    if (seen === frame) return seen;
  }
  return seen;
}

/** Reads the composite framebuffer, flipped back to top-down. */
function readComposite(comp: Compositor): ImageData {
  const { gl } = comp;
  gl.bindFramebuffer(gl.FRAMEBUFFER, currentAccumulator(comp).fbo);
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const flipped = new Uint8ClampedArray(pixels.length);
  const rowBytes = SIZE * 4;
  for (let y = 0; y < SIZE; y++) {
    const from = (SIZE - 1 - y) * rowBytes;
    flipped.set(pixels.subarray(from, from + rowBytes), y * rowBytes);
  }
  return new ImageData(flipped, SIZE, SIZE);
}

function isLit(image: ImageData): boolean {
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i] > 24 || image.data[i + 1] > 24 || image.data[i + 2] > 24) {
      return true;
    }
  }
  return false;
}

function markerOf(image: ImageData): number {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.putImageData(image, 0, 0);
  return readFrameMarker(context, image.width, image.height);
}

beforeEach(() => {
  clock.pause();
  clock.seekFrame(0);
  setPlayheadFrame(0);
});

afterEach(() => {
  scheduler?.stop();
  scheduler = null;
  dispose?.();
  dispose = null;
  if (compositor) disposeCompositor(compositor);
  compositor = null;
  host?.remove();
  host = null;
  forgetAllAssets();
  resetLeakCounters();
  loadDocument(createEmptyDoc());
});

describe("showing the timeline", () => {
  it("draws the clip under the playhead without anything being played", async () => {
    // Dropping a clip on the timeline and looking at it is the first thing
    // anyone does. Nothing warms the cache here, because nothing does in the
    // application either — which is why the preview used to stay black until
    // you pressed play.
    await setUp();
    const comp = startScheduler();

    expect(isLit(await settle(comp)), "the preview should not be black").toBe(true);
  });

  it("follows the playhead when the timeline scrubs it", async () => {
    // The timeline sets the store's playhead directly; it does not go through
    // the transport. The preview has to follow that, not the clock's separate
    // idea of where it is.
    await setUp();
    const comp = startScheduler();
    await settle(comp);

    setPlayheadFrame(40);
    expect(await settleOn(comp, 40)).toBe(40);
  });

  it("follows a transport seek too", async () => {
    await setUp();
    const comp = startScheduler();
    await settle(comp);

    seekToFrame(25);
    expect(await settleOn(comp, 25)).toBe(25);
  });

  it("redraws when a clip is added while parked", async () => {
    // An empty timeline is legitimately black; the point is that it stops
    // being black the moment there is something to show.
    const base = createEmptyDoc();
    base.sequence.frameRate = FPS_30;
    base.sequence.width = SIZE;
    base.sequence.height = SIZE;
    loadDocument(base);

    const comp = startScheduler();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(isLit(readComposite(comp))).toBe(false);

    await setUp();
    expect(isLit(await settle(comp)), "adding a clip should show it").toBe(true);
  });

  it("keeps up with a scrub across several frames", async () => {
    // Dragging the playhead is a stream of positions, and a decode landing
    // late must not leave the preview parked on one of the ones it passed.
    await setUp();
    const comp = startScheduler();
    await settle(comp);

    for (const frame of [10, 20, 30]) setPlayheadFrame(frame);
    setPlayheadFrame(50);

    expect(await settleOn(comp, 50)).toBe(50);
  });
});

describe("playing after a scrub", () => {
  it("starts from where the playhead was left", async () => {
    // The timeline moves the store's playhead without telling the clock, so
    // playback has to pick the playhead up rather than resuming from wherever
    // the clock was last anchored — which was frame 0, all the way back.
    await setUp();
    const comp = startScheduler();
    await settle(comp);

    setPlayheadFrame(45);
    await settleOn(comp, 45);

    play();
    // One frame of playback is enough to show which end it started from.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const frame = clock.nowFrame();
    pause();

    expect(frame).toBeGreaterThanOrEqual(45);
  });
});

describe("the panel", () => {
  it("mounts and gets a GL context", () => {
    host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:640px;height:480px";
    document.body.append(host);
    const disposePanel = render(() => <PreviewPanel />, host);

    const canvas = host.querySelector("canvas");
    expect(canvas).toBeTruthy();
    // The placeholder is shown only when the compositor failed to start.
    expect(host.textContent).not.toContain(`${SIZE} × ${SIZE}`);

    disposePanel();
  });
});
