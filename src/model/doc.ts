/**
 * The project document.
 *
 * Two rules shape everything here:
 *
 * 1. **All times are integer frames.** Seconds are a derived view. Float
 *    seconds made split, trim and snap approximate — clips butted together
 *    developed sub-frame gaps, and a value that survived a save could differ
 *    from the one that produced it.
 *
 * 2. **Media is referenced by content key.** An asset is identified by what it
 *    is, not by an id minted at import time, so a project file can be reopened
 *    on another machine and relinked.
 *
 * The document is treated as immutable: edits produce a new document via
 * structural sharing (see `history.ts`). Nothing here mutates in place except
 * inside a `mutative` draft.
 */

import type { FrameRate } from "@/lib/timecode";
import type { Animatable } from "@/lib/animation";
import type { ContentKey } from "./ids";

export const DOC_FORMAT_VERSION = 3;

// ── Assets ────────────────────────────────────────────────────────────

export type AssetKind = "video" | "audio" | "image";

/**
 * Why an asset can't currently be decoded. Surfaced to the user rather than
 * swallowed — a clip that renders black with no explanation is the single most
 * confusing failure this editor had.
 */
export type AssetProblem =
  | { kind: "offline"; detail: string }
  | { kind: "permission"; detail: string }
  | { kind: "unsupported-codec"; detail: string }
  | { kind: "decode-failed"; detail: string };

export interface Asset {
  /** Content key; also the document-wide id for this media. */
  id: ContentKey;
  name: string;
  kind: AssetKind;
  /** Bytes, used together with the name for relink matching. */
  size: number;
  /** Last modified time, for relink heuristics. Milliseconds since epoch. */
  mtime?: number;
  /** Path relative to the project file, when it is known. */
  relPath?: string;
  /** Source duration in seconds. Frame counts are derived per sequence rate. */
  durationSec: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  /** Native frame rate, when the container reports one. */
  frameRate?: FrameRate;
  /** Set when the asset cannot currently be read or decoded. */
  problem?: AssetProblem;
}

// ── Clip content ──────────────────────────────────────────────────────

export type BlendMode = "normal" | "add" | "screen" | "multiply";
export type FitMode = "contain" | "cover" | "fill" | "none";

export interface Transform {
  /** Offset from centre, as a fraction of frame height. Resolution-independent. */
  x: Animatable<number>;
  y: Animatable<number>;
  scaleX: Animatable<number>;
  scaleY: Animatable<number>;
  /** Degrees, clockwise. */
  rotation: Animatable<number>;
  /** Rotation/scale origin, 0..1 within the layer. */
  anchorX: number;
  anchorY: number;
}

/** Fractions of the source frame trimmed from each edge, 0..1. */
export interface Crop {
  left: Animatable<number>;
  right: Animatable<number>;
  top: Animatable<number>;
  bottom: Animatable<number>;
}

export interface ClipEffect {
  id: string;
  definitionId: string;
  enabled: boolean;
  /** Uniform name -> animatable value. Scalars and vectors share one evaluator. */
  params: Record<string, Animatable<number | number[]>>;
}

export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  color: string;
  backgroundColor?: string;
  /** Normalised 0..1 position within the frame. */
  x: number;
  y: number;
  align: "left" | "center" | "right";
}

/**
 * What a clip shows. A title carries its style inline rather than pointing at a
 * magic `"__text__"` asset id that no asset table ever contained.
 */
export type ClipSource =
  | { type: "asset"; assetId: ContentKey }
  | { type: "text"; style: TextStyle }
  | { type: "solid"; color: string };

export interface Clip {
  id: string;
  source: ClipSource;

  /** Position on the timeline, in frames from zero. */
  startFrame: number;
  /** Length on the timeline, in frames. Always > 0. */
  durationFrames: number;
  /** First source frame shown. Always >= 0. */
  inPointFrames: number;

  /** Playback rate multiplier. 2 plays twice as fast and consumes 2x source. */
  speed: number;
  /** Whether a video clip contributes its own audio to the mix. */
  linkedAudio: boolean;
  enabled: boolean;

  opacity: Animatable<number>;
  volume: Animatable<number>;
  /** -1 hard left to +1 hard right. */
  pan: Animatable<number>;
  /** Fade lengths in frames, applied at the clip's own edges. */
  fadeInFrames: number;
  fadeOutFrames: number;

  transform: Transform;
  crop: Crop;
  fit: FitMode;
  blend: BlendMode;
  effects: ClipEffect[];
}

// ── Tracks ────────────────────────────────────────────────────────────

export type TransitionType = "crossfade" | "dip-to-black" | "wipe-left" | "wipe-right";

/**
 * A transition is an edge between two adjacent clips, not a property of one.
 * Rendering it needs both sides, and hanging it off the right-hand clip made
 * that relationship invisible to the compositor — which is why transitions were
 * stored, drawn in the timeline, and never rendered.
 */
export interface Transition {
  id: string;
  leftClipId: string;
  rightClipId: string;
  type: TransitionType;
  durationFrames: number;
}

export interface Track {
  id: string;
  name: string;
  kind: "video" | "audio";
  /** Always sorted by startFrame and non-overlapping. See invariants.ts. */
  clips: Clip[];
  transitions: Transition[];
  muted: boolean;
  soloed: boolean;
  locked: boolean;
  /** Display height in pixels; timeline lanes are individually resizable. */
  heightPx: number;
}

// ── Markers ───────────────────────────────────────────────────────────

export interface Marker {
  id: string;
  frame: number;
  name: string;
  color: string;
  note?: string;
}

// ── Document ──────────────────────────────────────────────────────────

export interface Sequence {
  frameRate: FrameRate;
  width: number;
  height: number;
  sampleRate: number;
}

export interface ProjectDoc {
  formatVersion: number;
  name: string;
  sequence: Sequence;
  assets: Asset[];
  tracks: Track[];
  markers: Marker[];
}

// ── Constructors ──────────────────────────────────────────────────────

import { newId } from "./ids";
import { FPS_30 } from "@/lib/timecode";
import { constant } from "@/lib/animation";

export function defaultTransform(): Transform {
  return {
    x: constant(0),
    y: constant(0),
    scaleX: constant(1),
    scaleY: constant(1),
    rotation: constant(0),
    anchorX: 0.5,
    anchorY: 0.5,
  };
}

export function defaultCrop(): Crop {
  return {
    left: constant(0),
    right: constant(0),
    top: constant(0),
    bottom: constant(0),
  };
}

export function createClip(
  source: ClipSource,
  startFrame: number,
  durationFrames: number,
  overrides: Partial<Clip> = {},
): Clip {
  return {
    id: newId("clip"),
    source,
    startFrame,
    durationFrames,
    inPointFrames: 0,
    speed: 1,
    linkedAudio: true,
    enabled: true,
    opacity: constant(1),
    volume: constant(1),
    pan: constant(0),
    fadeInFrames: 0,
    fadeOutFrames: 0,
    transform: defaultTransform(),
    crop: defaultCrop(),
    fit: "contain",
    blend: "normal",
    effects: [],
    ...overrides,
  };
}

function cloneAnimatable<T>(param: Animatable<T>): Animatable<T> {
  return {
    value: Array.isArray(param.value)
      ? ([...param.value] as unknown as T)
      : param.value,
    keys: param.keys?.map((k) => ({
      ...k,
      id: newId("key"),
      value: Array.isArray(k.value) ? ([...k.value] as unknown as T) : k.value,
      out: k.out ? ([...k.out] as [number, number]) : undefined,
      in: k.in ? ([...k.in] as [number, number]) : undefined,
    })),
  };
}

/**
 * Deep copy of a clip, for split and for clearing a range.
 *
 * Written out rather than using `structuredClone` because these run inside a
 * `mutative` draft, where every object is a Proxy that `structuredClone`
 * refuses with a DataCloneError. Being explicit also means a newly added clip
 * field has to be considered here rather than silently shared by reference
 * between the two halves of a cut.
 */
/**
 * A copy that can sit alongside the original.
 *
 * Every nested id is minted fresh — effects and keyframes included. The clip
 * id is the caller's business because a split wants a new one and the
 * clipboard wants to mirror the old one, but nothing inside should ever be
 * shared: two objects with one id is a bug waiting for the first feature that
 * looks one up without knowing which clip it came from.
 */
export function cloneClip(clip: Clip, id: string): Clip {
  return {
    id,
    source:
      clip.source.type === "text"
        ? { type: "text", style: { ...clip.source.style } }
        : { ...clip.source },
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    inPointFrames: clip.inPointFrames,
    speed: clip.speed,
    linkedAudio: clip.linkedAudio,
    enabled: clip.enabled,
    opacity: cloneAnimatable(clip.opacity),
    volume: cloneAnimatable(clip.volume),
    pan: cloneAnimatable(clip.pan),
    fadeInFrames: clip.fadeInFrames,
    fadeOutFrames: clip.fadeOutFrames,
    transform: {
      x: cloneAnimatable(clip.transform.x),
      y: cloneAnimatable(clip.transform.y),
      scaleX: cloneAnimatable(clip.transform.scaleX),
      scaleY: cloneAnimatable(clip.transform.scaleY),
      rotation: cloneAnimatable(clip.transform.rotation),
      anchorX: clip.transform.anchorX,
      anchorY: clip.transform.anchorY,
    },
    crop: {
      left: cloneAnimatable(clip.crop.left),
      right: cloneAnimatable(clip.crop.right),
      top: cloneAnimatable(clip.crop.top),
      bottom: cloneAnimatable(clip.crop.bottom),
    },
    fit: clip.fit,
    blend: clip.blend,
    effects: clip.effects.map((e) => ({
      id: newId("fx"),
      definitionId: e.definitionId,
      enabled: e.enabled,
      params: Object.fromEntries(
        Object.entries(e.params).map(([k, v]) => [k, cloneAnimatable(v)]),
      ),
    })),
  };
}

export function createTrack(
  kind: "video" | "audio",
  name: string,
  overrides: Partial<Track> = {},
): Track {
  return {
    id: newId("track"),
    name,
    kind,
    clips: [],
    transitions: [],
    muted: false,
    soloed: false,
    locked: false,
    heightPx: kind === "video" ? 64 : 48,
    ...overrides,
  };
}

export function createEmptyDoc(name = "Untitled Project"): ProjectDoc {
  return {
    formatVersion: DOC_FORMAT_VERSION,
    name,
    sequence: {
      frameRate: FPS_30,
      width: 1920,
      height: 1080,
      sampleRate: 48000,
    },
    assets: [],
    tracks: [
      createTrack("video", "Video 1"),
      createTrack("video", "Video 2"),
      createTrack("audio", "Audio 1"),
      createTrack("audio", "Audio 2"),
    ],
    markers: [],
  };
}

// ── Queries ───────────────────────────────────────────────────────────

/** Exclusive end frame: a clip occupies [startFrame, endFrame). */
export function clipEndFrame(clip: Clip): number {
  return clip.startFrame + clip.durationFrames;
}

/**
 * Source frames consumed by a clip, accounting for speed. A 2x clip covering
 * 30 timeline frames reads 60 source frames.
 */
export function clipSourceSpan(clip: Clip): number {
  return Math.round(clip.durationFrames * clip.speed);
}

/** Source frame shown at a given timeline frame. */
export function sourceFrameAt(clip: Clip, timelineFrame: number): number {
  return (
    clip.inPointFrames + Math.round((timelineFrame - clip.startFrame) * clip.speed)
  );
}

export function findTrack(doc: ProjectDoc, trackId: string): Track | undefined {
  return doc.tracks.find((t) => t.id === trackId);
}

export function findClip(
  doc: ProjectDoc,
  clipId: string,
): { track: Track; clip: Clip } | undefined {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

export function findAsset(doc: ProjectDoc, assetId: ContentKey): Asset | undefined {
  return doc.assets.find((a) => a.id === assetId);
}

/**
 * The clip visible on a track at a frame. Clips are non-overlapping and sorted,
 * so this is unambiguous — unlike the previous first-match-wins scan over an
 * unsorted array, where render order depended on edit history.
 */
export function clipAt(track: Track, frame: number): Clip | undefined {
  for (const clip of track.clips) {
    if (frame < clip.startFrame) return undefined;
    if (frame < clipEndFrame(clip)) return clip;
  }
  return undefined;
}

/** Last frame occupied by any clip, or 0 for an empty timeline. */
export function contentEndFrame(doc: ProjectDoc): number {
  let end = 0;
  for (const track of doc.tracks) {
    const last = track.clips[track.clips.length - 1];
    if (last) end = Math.max(end, clipEndFrame(last));
  }
  return end;
}

/** Frames where clips begin or end, plus markers — snap candidates. */
export function snapFrames(doc: ProjectDoc, excludeClipId?: string): number[] {
  const frames = new Set<number>([0]);
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      frames.add(clip.startFrame);
      frames.add(clipEndFrame(clip));
    }
  }
  for (const marker of doc.markers) frames.add(marker.frame);
  return [...frames].sort((a, b) => a - b);
}

/**
 * Source duration in frames at the sequence rate, or null when unknown (an
 * offline or unprobed asset). Callers must treat null as "don't clamp" rather
 * than as zero.
 */
export function assetDurationFrames(
  asset: Asset | undefined,
  rate: FrameRate,
): number | null {
  if (!asset || !Number.isFinite(asset.durationSec) || asset.durationSec <= 0) {
    return null;
  }
  return Math.round((asset.durationSec * rate.num) / rate.den);
}
