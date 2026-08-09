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
import { type Clip, type ProjectDoc } from "@/model/doc";
import { framesToSeconds, secondsToFrames } from "@/lib/timecode";

export type Compositor = GraphContext;

/**
 * @param size Render at this size instead of the sequence's.
 *
 * The preview renders smaller than the project and the export sometimes
 * renders larger, and both used to build the graph at the sequence size and
 * immediately resize it — allocating a full set of 4K buffers to throw them
 * away a moment later.
 */
export function createCompositor(
  canvas: HTMLCanvasElement,
  size?: { width: number; height: number },
): Compositor | null {
  const sequence = currentDoc().sequence;
  return createGraph(
    canvas,
    size?.width ?? sequence.width,
    size?.height ?? sequence.height,
  );
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
 * The clips a frame needs, from the scene rather than from the tracks.
 *
 * `clipAt` per track is not the same thing: mid-transition both sides are on
 * screen, and one of them is being read from outside its own span. The scene
 * already works that out, so asking it is both shorter and right.
 */
function clipsFor(document_: ProjectDoc, frame: number): Clip[] {
  const seen = new Set<string>();
  const clips: Clip[] = [];
  for (const request of buildScene(document_, frame).requests) {
    if (seen.has(request.clipId)) continue;
    seen.add(request.clipId);
    const clip = findClipById(document_, request.clipId);
    if (clip) clips.push(clip);
  }
  return clips;
}

/**
 * Decodes ahead for the clips about to be needed, and drops decoders for those
 * that are not.
 */
export function primeFrames(frame: number): void {
  const document_ = currentDoc();
  const active = clipsFor(document_, frame);
  mediaEngine.prefetch(document_, active, frame);
  mediaEngine.retain(active.map((c) => c.id));
}

/**
 * Waits for everything a frame needs, so a paused preview can settle on it.
 *
 * The render pass never waits — that is what stops renders overlapping — so
 * something has to. While playing, the prefetch running ahead covers it and a
 * late frame is simply repeated. While *paused* there is no next frame to
 * repeat into: without this the preview shows black until you start playing,
 * which is what it did.
 */
export async function settleFrame(frame: number): Promise<void> {
  const document_ = currentDoc();
  const borrowed = await Promise.all(
    clipsFor(document_, frame).map((clip) =>
      mediaEngine.getExact(document_, clip, frame).catch(() => null),
    ),
  );
  // Released immediately: this is only to get them into the cache, and the
  // render pass borrows its own references.
  for (const frameRef of borrowed) frameRef?.release();
}

/** The framebuffer holding the finished picture, for readback in tests. */
export { currentAccumulator };

/** Seconds at a frame, for callers that need it alongside a render. */
export function frameToSeconds(frame: number): number {
  return framesToSeconds(frame, currentDoc().sequence.frameRate);
}
