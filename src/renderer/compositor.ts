/**
 * The compositor: the bridge between the document and the render graph.
 *
 * Its whole job is now to build a scene, resolve each layer's picture, and
 * hand both to the graph. All the drawing lives in `graph.ts`; all the policy
 * lives in `scene.ts`. This file used to contain both, plus keyframe
 * evaluation, plus frame seeking.
 */

import { buildScene, type Layer, type Scene } from "./scene";
import {
  composeFrame,
  createGraph,
  currentAccumulator,
  disposeGraph,
  resizeGraph,
  type GraphContext,
  type LayerImage,
} from "./graph";
import { rasteriseSolid, rasteriseText, rasteriseSubtitle } from "./text-renderer";
import { mediaEngine, type BorrowedFrame } from "@/media/engine";
import { doc as currentDoc } from "@/stores/project-store";
import { clipAt, type Clip, type ProjectDoc } from "@/model/doc";
import { framesToSeconds, secondsToFrames } from "@/lib/timecode";

export type Compositor = GraphContext;

export function createCompositor(canvas: HTMLCanvasElement): Compositor | null {
  const sequence = currentDoc().sequence;
  return createGraph(canvas, sequence.width, sequence.height);
}

export function resizeCompositor(
  comp: Compositor,
  width: number,
  height: number,
): void {
  resizeGraph(comp, width, height);
}

export function disposeCompositor(comp: Compositor): void {
  disposeGraph(comp);
}

/** A frame reference held for one pass and released with the rest. */
interface Borrowed {
  release: () => void;
}

/**
 * How a pass obtains a decoded frame.
 *
 * The two schedulers differ here and nowhere else. Preview uses `tryGet`,
 * which never waits — a frame that is not ready yet is skipped for this pass,
 * which is what stops renders overlapping. Export awaits every frame before
 * rendering and hands them in through this hook, which is what makes it
 * deterministic. Returning a reference transfers ownership: the pass releases
 * it.
 */
export type FrameLookup = (
  document_: ProjectDoc,
  clip: Clip,
  frame: number,
) => BorrowedFrame | null;

function findClipById(document_: ProjectDoc, clipId: string): Clip | undefined {
  for (const track of document_.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

/**
 * Supplies each layer's picture.
 *
 * Frames are borrowed, not copied, so every reference taken here is collected
 * and released once the pass finishes.
 */
function makeResolver(
  document_: ProjectDoc,
  scene: Scene,
  borrowed: Borrowed[],
  lookup: FrameLookup,
) {
  return (layer: Layer): LayerImage | null => {
    if (layer.source.type === "text") {
      const raster = rasteriseText(layer.source.style, scene.width, scene.height);
      return { image: raster.canvas, width: raster.width, height: raster.height };
    }
    if (layer.source.type === "subtitle") {
      const raster = rasteriseSubtitle(layer.source, scene.width, scene.height);
      return { image: raster.canvas, width: raster.width, height: raster.height };
    }
    if (layer.source.type === "solid") {
      const raster = rasteriseSolid(layer.source.color, scene.width, scene.height);
      return { image: raster.canvas, width: raster.width, height: raster.height };
    }

    // The engine maps the timeline frame through in-point and speed itself,
    // so it needs the clip rather than the already-resolved source frame.
    const clip = findClipById(document_, layer.clipId);
    if (!clip) return null;

    const frame = lookup(document_, clip, scene.frame);
    if (!frame) return null;

    borrowed.push(frame);
    return {
      image: frame.sample.toCanvasImageSource() as TexImageSource,
      width: frame.sample.displayWidth,
      height: frame.sample.displayHeight,
    };
  };
}

/**
 * Renders the timeline at a frame.
 *
 * Synchronous. A layer whose frame is not yet decoded is skipped for this pass
 * rather than awaited, which is what stops renders overlapping.
 */
export function renderFrame(
  comp: Compositor,
  frame: number,
  lookup: FrameLookup = previewLookup,
  document_: ProjectDoc = currentDoc(),
): void {
  if (comp.disposed) return;

  const scene = buildScene(document_, frame);
  const borrowed: Borrowed[] = [];

  try {
    composeFrame(comp, scene, makeResolver(document_, scene, borrowed, lookup));
  } finally {
    // In a finally so a GL error cannot pin frames in the cache forever.
    for (const frameRef of borrowed) frameRef.release();
  }
}

/** The preview's lookup: take what is decoded, never wait for what is not. */
const previewLookup: FrameLookup = (document_, clip, frame) =>
  mediaEngine.tryGet(document_, clip, frame);

/** Renders at a time in seconds, for callers still thinking in seconds. */
export function renderAtSeconds(comp: Compositor, seconds: number): void {
  renderFrame(comp, secondsToFrames(seconds, currentDoc().sequence.frameRate));
}

/** Clears the canvas to black — used before the first frame is available. */
export function renderBlackFrame(comp: Compositor): void {
  const { gl, canvas } = comp;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * Decodes ahead for the clips about to be needed, and drops decoders for those
 * that are not.
 */
export function primeFrames(frame: number): void {
  const document_ = currentDoc();
  const active: Clip[] = [];
  for (const track of document_.tracks) {
    if (track.kind !== "video") continue;
    const clip = clipAt(track, frame);
    if (clip) active.push(clip);
  }
  mediaEngine.prefetch(document_, active, frame);
  mediaEngine.retain(active.map((c) => c.id));
}

/** The framebuffer holding the finished picture, for readback in tests. */
export { currentAccumulator };

/** Seconds at a frame, for callers that need it alongside a render. */
export function frameToSeconds(frame: number): number {
  return framesToSeconds(frame, currentDoc().sequence.frameRate);
}
