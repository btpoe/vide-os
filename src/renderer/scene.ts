/**
 * Turning a document and a frame number into a description of what to draw.
 *
 * A `Scene` is **plain data with every parameter already evaluated**. No
 * animatables, no keyframes, no lookups — just numbers. That has three
 * consequences worth the discipline:
 *
 * - the renderer contains no policy, only drawing;
 * - a scene can be snapshot-tested without a GPU;
 * - it is structured-cloneable, so the compositing step could move to a worker
 *   without rethinking the boundary.
 *
 * Pure: no GL, no async, no stores.
 */

import {
  type BlendMode,
  type Clip,
  type FitMode,
  type ProjectDoc,
  type TextStyle,
  type TransitionType,
  clipAt,
  clipEndFrame,
  sourceFrameAt,
} from "@/model/doc";
import { evaluate } from "@/lib/animation";
import type { ContentKey } from "@/model/ids";

// ── Scene shape ───────────────────────────────────────────────────────

export interface EvaluatedTransform {
  /** Offset from centre, as a fraction of frame height. Resolution-independent. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
  anchorX: number;
  anchorY: number;
}

/** Fractions trimmed from each edge of the source, 0..1. */
export interface EvaluatedCrop {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface EvaluatedEffect {
  definitionId: string;
  values: Record<string, number | number[]>;
}

export type LayerSource =
  | { type: "asset"; assetId: ContentKey; sourceFrame: number }
  | { type: "text"; style: TextStyle }
  | { type: "solid"; color: string };

export interface Layer {
  clipId: string;
  source: LayerSource;
  transform: EvaluatedTransform;
  crop: EvaluatedCrop;
  fit: FitMode;
  opacity: number;
  blend: BlendMode;
  effects: EvaluatedEffect[];
}

/**
 * One thing to composite. A transition carries *both* sides plus its progress,
 * because rendering one needs both — which is exactly what the old model could
 * not express, since a transition was a property of a single clip.
 */
export type SceneNode =
  | { kind: "layer"; layer: Layer }
  | {
      kind: "transition";
      type: TransitionType;
      /** 0 at the start of the overlap, 1 at the end. */
      progress: number;
      from: Layer;
      to: Layer;
    };

export interface FrameRequest {
  assetId: ContentKey;
  clipId: string;
  sourceFrame: number;
}

export interface Scene {
  frame: number;
  width: number;
  height: number;
  /** Bottom layer first, so a straight iteration composites in order. */
  nodes: SceneNode[];
  /** Every frame the renderer will need, flat, for prefetching. */
  requests: FrameRequest[];
}

// ── Building ──────────────────────────────────────────────────────────

function evaluateTransform(clip: Clip, localFrame: number): EvaluatedTransform {
  return {
    x: evaluate(clip.transform.x, localFrame),
    y: evaluate(clip.transform.y, localFrame),
    scaleX: evaluate(clip.transform.scaleX, localFrame),
    scaleY: evaluate(clip.transform.scaleY, localFrame),
    rotation: evaluate(clip.transform.rotation, localFrame),
    anchorX: clip.transform.anchorX,
    anchorY: clip.transform.anchorY,
  };
}

function evaluateCrop(clip: Clip, localFrame: number): EvaluatedCrop {
  // Clamped so opposing edges cannot cross and produce a negative-size source
  // rectangle, which would sample garbage.
  const left = Math.max(0, Math.min(1, evaluate(clip.crop.left, localFrame)));
  const right = Math.max(0, Math.min(1 - left, evaluate(clip.crop.right, localFrame)));
  const top = Math.max(0, Math.min(1, evaluate(clip.crop.top, localFrame)));
  const bottom = Math.max(0, Math.min(1 - top, evaluate(clip.crop.bottom, localFrame)));
  return { left, right, top, bottom };
}

function evaluateEffects(clip: Clip, localFrame: number): EvaluatedEffect[] {
  return clip.effects
    .filter((effect) => effect.enabled)
    .map((effect) => {
      const values: Record<string, number | number[]> = {};
      for (const [name, param] of Object.entries(effect.params)) {
        values[name] = evaluate(param, localFrame);
      }
      return { definitionId: effect.definitionId, values };
    });
}

function buildLayer(clip: Clip, frame: number): Layer | null {
  if (!clip.enabled) return null;

  const localFrame = frame - clip.startFrame;

  let source: LayerSource;
  switch (clip.source.type) {
    case "asset":
      source = {
        type: "asset",
        assetId: clip.source.assetId,
        sourceFrame: sourceFrameAt(clip, frame),
      };
      break;
    case "text":
      source = { type: "text", style: clip.source.style };
      break;
    case "solid":
      source = { type: "solid", color: clip.source.color };
      break;
  }

  return {
    clipId: clip.id,
    source,
    transform: evaluateTransform(clip, localFrame),
    crop: evaluateCrop(clip, localFrame),
    fit: clip.fit,
    opacity: Math.max(0, Math.min(1, evaluate(clip.opacity, localFrame))),
    blend: clip.blend,
    effects: evaluateEffects(clip, localFrame),
  };
}

/**
 * The transition covering a frame on a track, if any.
 *
 * A transition occupies the last `durationFrames` of the left clip: for that
 * window both clips are rendered and blended. Outside it, the ordinary
 * single-clip path applies.
 */
function transitionAt(
  doc: ProjectDoc,
  trackId: string,
  frame: number,
): { type: TransitionType; progress: number; from: Clip; to: Clip } | null {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) return null;

  for (const transition of track.transitions) {
    const from = track.clips.find((c) => c.id === transition.leftClipId);
    const to = track.clips.find((c) => c.id === transition.rightClipId);
    if (!from || !to) continue;

    const end = clipEndFrame(from);
    const start = end - transition.durationFrames;
    if (frame < start || frame >= end) continue;

    // Guard against a zero-length transition dividing by zero.
    const span = Math.max(1, transition.durationFrames);
    return {
      type: transition.type,
      progress: Math.max(0, Math.min(1, (frame - start) / span)),
      from,
      to,
    };
  }
  return null;
}

/**
 * Describes the frame.
 *
 * Tracks are composited bottom to top. The document lists them top-first, so
 * they are reversed here rather than at every draw site.
 */
export function buildScene(doc: ProjectDoc, frame: number): Scene {
  const nodes: SceneNode[] = [];
  const requests: FrameRequest[] = [];

  const addRequest = (layer: Layer) => {
    if (layer.source.type !== "asset") return;
    requests.push({
      assetId: layer.source.assetId,
      clipId: layer.clipId,
      sourceFrame: layer.source.sourceFrame,
    });
  };

  const videoTracks = doc.tracks.filter((t) => t.kind === "video" && !t.muted);

  // Bottom to top.
  for (const track of [...videoTracks].reverse()) {
    const transition = transitionAt(doc, track.id, frame);

    if (transition) {
      const from = buildLayer(transition.from, frame);
      // The incoming clip is rendered from *before* its own start, reaching
      // into the handle material beyond its in-point. That is what a
      // transition needs and why one is refused when the handles are absent.
      const to = buildLayer(transition.to, frame);
      if (from && to) {
        nodes.push({
          kind: "transition",
          type: transition.type,
          progress: transition.progress,
          from,
          to,
        });
        addRequest(from);
        addRequest(to);
        continue;
      }
    }

    const clip = clipAt(track, frame);
    if (!clip) continue;
    const layer = buildLayer(clip, frame);
    if (!layer) continue;

    nodes.push({ kind: "layer", layer });
    addRequest(layer);
  }

  return {
    frame,
    width: doc.sequence.width,
    height: doc.sequence.height,
    nodes,
    requests,
  };
}

/** Every layer in a scene, including both sides of any transition. */
export function sceneLayers(scene: Scene): Layer[] {
  return scene.nodes.flatMap((node) =>
    node.kind === "layer" ? [node.layer] : [node.from, node.to],
  );
}
