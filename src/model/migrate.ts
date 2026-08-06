/**
 * Project file migration.
 *
 * Version history:
 *
 * - **v1** — `.videos.json`, the original format. Float seconds, decimal fps,
 *   `Date.now()` media ids, and *no media table at all*, so every clip
 *   references media that cannot be resolved. Migrating one necessarily
 *   produces a project whose assets are all offline; the user has to relink.
 * - **v2** — never shipped. Reserved so the version number matches the
 *   document's `formatVersion` field.
 * - **v3** — integer frames, rational frame rate, content-keyed assets,
 *   transitions as edges, animatable clip properties.
 *
 * Each step is a pure function from one shape to the next; `migrate` runs the
 * chain. Fixtures for every version live in the tests, so a change that breaks
 * an old file fails CI rather than a user's project.
 */

import {
  type ProjectDoc,
  type Track,
  type Clip,
  type Asset,
  type ClipSource,
  type TransitionType,
  DOC_FORMAT_VERSION,
  createEmptyDoc,
  createClip,
  createTrack,
} from "./doc";
import { newId } from "./ids";
import { EASING_PRESETS, type Keyframe } from "@/lib/animation";
import { frameRateFromNumber, secondsToFrames, type FrameRate } from "@/lib/timecode";

// ── v1 shapes ─────────────────────────────────────────────────────────

interface V1Keyframe {
  id?: string;
  time?: number;
  value?: number;
  easing?: string;
}

interface V1Effect {
  id?: string;
  definitionId?: string;
  values?: Record<string, number | number[]>;
  keyframes?: Record<string, V1Keyframe[]>;
}

interface V1TextOverlay {
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  x?: number;
  y?: number;
  align?: string;
}

interface V1Clip {
  id?: string;
  mediaId?: string;
  startTime?: number;
  duration?: number;
  inPoint?: number;
  outPoint?: number;
  effects?: V1Effect[];
  transition?: { type?: string; duration?: number };
  textOverlay?: V1TextOverlay;
}

interface V1Track {
  id?: string;
  name?: string;
  type?: string;
  clips?: V1Clip[];
  muted?: boolean;
  locked?: boolean;
}

interface V1Doc {
  name?: string;
  tracks?: V1Track[];
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
}

export interface MigrationResult {
  doc: ProjectDoc;
  /** Human-readable notes to show the user after opening an old project. */
  warnings: string[];
}

// ── v1 → v3 ───────────────────────────────────────────────────────────

const V1_EASING_TO_INTERP: Record<
  string,
  { interp: "hold" | "linear" | "bezier"; preset?: keyof typeof EASING_PRESETS }
> = {
  hold: { interp: "hold" },
  linear: { interp: "linear" },
  "ease-in": { interp: "bezier", preset: "ease-in" },
  "ease-out": { interp: "bezier", preset: "ease-out" },
  "ease-in-out": { interp: "bezier", preset: "ease-in-out" },
};

function migrateKeyframes(
  keys: V1Keyframe[] | undefined,
  rate: FrameRate,
): Keyframe<number | number[]>[] | undefined {
  if (!keys?.length) return undefined;
  return keys
    .map((k) => {
      const mapping = V1_EASING_TO_INTERP[k.easing ?? "linear"] ?? {
        interp: "linear" as const,
      };
      const preset = mapping.preset ? EASING_PRESETS[mapping.preset] : undefined;
      return {
        id: k.id ?? newId("kf"),
        timeFrames: secondsToFrames(k.time ?? 0, rate),
        value: k.value ?? 0,
        interp: mapping.interp,
        out: preset ? ([...preset.out] as [number, number]) : undefined,
        in: preset ? ([...preset.in] as [number, number]) : undefined,
      };
    })
    .sort((a, b) => a.timeFrames - b.timeFrames);
}

function migrateEffect(effect: V1Effect, rate: FrameRate) {
  const params: Record<
    string,
    { value: number | number[]; keys?: Keyframe<number | number[]>[] }
  > = {};
  for (const [name, value] of Object.entries(effect.values ?? {})) {
    params[name] = {
      value,
      keys: migrateKeyframes(effect.keyframes?.[name], rate),
    };
  }
  return {
    id: effect.id ?? newId("fx"),
    definitionId: effect.definitionId ?? "unknown",
    enabled: true,
    params,
  };
}

const V1_TRANSITION_TYPES = new Set<TransitionType>([
  "crossfade",
  "dip-to-black",
  "wipe-left",
  "wipe-right",
]);

function migrateClip(v1: V1Clip, rate: FrameRate): Clip | null {
  const startFrame = secondsToFrames(v1.startTime ?? 0, rate);
  const durationFrames = secondsToFrames(v1.duration ?? 0, rate);
  if (durationFrames <= 0) return null;

  // v1 marked titles with the sentinel media id "__text__"; there was never an
  // asset behind it. Titles now carry their style inline.
  const source: ClipSource =
    v1.mediaId === "__text__" && v1.textOverlay
      ? {
          type: "text",
          style: {
            text: v1.textOverlay.text ?? "",
            fontFamily: v1.textOverlay.fontFamily ?? "sans-serif",
            fontSize: v1.textOverlay.fontSize ?? 48,
            fontWeight: v1.textOverlay.fontWeight === "bold" ? "bold" : "normal",
            color: v1.textOverlay.color ?? "#ffffff",
            backgroundColor: v1.textOverlay.backgroundColor,
            x: v1.textOverlay.x ?? 0.5,
            y: v1.textOverlay.y ?? 0.5,
            align:
              v1.textOverlay.align === "left" || v1.textOverlay.align === "right"
                ? v1.textOverlay.align
                : "center",
          },
        }
      : { type: "asset", assetId: v1.mediaId ?? "" };

  return createClip(source, startFrame, durationFrames, {
    id: v1.id ?? newId("clip"),
    inPointFrames: Math.max(0, secondsToFrames(v1.inPoint ?? 0, rate)),
    effects: (v1.effects ?? []).map((e) => migrateEffect(e, rate)),
  });
}

function migrateV1(raw: V1Doc): MigrationResult {
  const warnings: string[] = [];
  const rate = frameRateFromNumber(raw.fps ?? 30);

  const doc = createEmptyDoc(raw.name ?? "Untitled Project");
  doc.sequence = {
    frameRate: rate,
    width: raw.width ?? 1920,
    height: raw.height ?? 1080,
    sampleRate: 48000,
  };

  const referencedAssetIds = new Set<string>();
  const tracks: Track[] = [];
  const pendingTransitions: {
    trackIndex: number;
    clipId: string;
    type: TransitionType;
    durationFrames: number;
  }[] = [];

  for (const v1Track of raw.tracks ?? []) {
    const kind = v1Track.type === "audio" ? "audio" : "video";
    const track = createTrack(kind, v1Track.name ?? "Track", {
      id: v1Track.id ?? newId("track"),
      muted: v1Track.muted ?? false,
      locked: v1Track.locked ?? false,
    });

    for (const v1Clip of v1Track.clips ?? []) {
      const clip = migrateClip(v1Clip, rate);
      if (!clip) continue;
      if (clip.source.type === "asset" && clip.source.assetId) {
        referencedAssetIds.add(clip.source.assetId);
      }

      // v1 hung a transition off the clip it transitioned *into*. Recorded now
      // and resolved into an edge below, once neighbours are known.
      const type = v1Clip.transition?.type;
      if (type && V1_TRANSITION_TYPES.has(type as TransitionType)) {
        pendingTransitions.push({
          trackIndex: tracks.length,
          clipId: clip.id,
          type: type as TransitionType,
          durationFrames: Math.max(
            1,
            secondsToFrames(v1Clip.transition?.duration ?? 1, rate),
          ),
        });
      }

      track.clips.push(clip);
    }

    // v1 never guaranteed sorting or non-overlap.
    track.clips.sort((a, b) => a.startFrame - b.startFrame);
    tracks.push(track);
  }

  // v1 had no media table, so every referenced id becomes an offline
  // placeholder asset. The ids are `Date.now()`-based and can never be
  // resolved, which is exactly why the format needed replacing.
  const assets: Asset[] = [...referencedAssetIds].map((id) => ({
    id,
    name: id,
    kind: "video" as const,
    size: 0,
    durationSec: 0,
    hasAudio: false,
    problem: {
      kind: "offline" as const,
      detail: "This project predates the media table. Relink the file to restore it.",
    },
  }));

  doc.tracks = tracks;
  doc.assets = assets;

  // Resolve transitions against their now-known left neighbours.
  for (const pending of pendingTransitions) {
    const track = doc.tracks[pending.trackIndex];
    if (!track) continue;
    const index = track.clips.findIndex((c) => c.id === pending.clipId);
    const left = track.clips[index - 1];
    if (index <= 0 || !left) {
      warnings.push(
        `Dropped a transition on "${track.name}" that had no clip before it.`,
      );
      continue;
    }
    track.transitions.push({
      id: newId("xf"),
      leftClipId: left.id,
      rightClipId: track.clips[index].id,
      type: pending.type,
      durationFrames: pending.durationFrames,
    });
  }

  // Overlaps were possible in v1; resolve them by trimming the earlier clip so
  // the result satisfies the invariants rather than failing validation on open.
  let trimmed = 0;
  for (const track of doc.tracks) {
    for (let i = 1; i < track.clips.length; i++) {
      const previous = track.clips[i - 1];
      const current = track.clips[i];
      const previousEnd = previous.startFrame + previous.durationFrames;
      if (previousEnd > current.startFrame) {
        previous.durationFrames = Math.max(1, current.startFrame - previous.startFrame);
        trimmed++;
      }
    }
  }
  if (trimmed > 0) {
    warnings.push(
      `Trimmed ${trimmed} overlapping clip${trimmed > 1 ? "s" : ""}; the old format allowed clips to overlap.`,
    );
  }

  if (assets.length > 0) {
    warnings.push(
      `${assets.length} media file${assets.length > 1 ? "s are" : " is"} offline. This project was saved in a format that did not record where media lived — use Relink Media to reconnect.`,
    );
  }

  if (raw.fps !== undefined && !Number.isInteger(raw.fps)) {
    warnings.push(`Frame rate ${raw.fps} was interpreted as ${rate.num}/${rate.den}.`);
  }

  doc.formatVersion = 3;
  return { doc, warnings };
}

// ── Entry point ───────────────────────────────────────────────────────

/** Detects the format version of a parsed project file. */
export function detectVersion(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return 0;
  const version = (raw as { formatVersion?: unknown }).formatVersion;
  if (typeof version === "number") return version;
  // v1 had no version field but always had a tracks array.
  if (Array.isArray((raw as { tracks?: unknown }).tracks)) return 1;
  return 0;
}

export class UnsupportedProjectError extends Error {
  constructor(readonly version: number) {
    super(
      version > DOC_FORMAT_VERSION
        ? `This project was saved by a newer version of VideOS (format ${version}). Update to open it.`
        : `Unrecognised project file (format ${version}).`,
    );
    this.name = "UnsupportedProjectError";
  }
}

/**
 * Brings a parsed project file up to the current format.
 *
 * Throws `UnsupportedProjectError` for a file from the future or one that isn't
 * a project at all. Never returns a partially migrated document.
 */
export function migrate(raw: unknown): MigrationResult {
  const version = detectVersion(raw);

  if (version === DOC_FORMAT_VERSION) {
    return { doc: raw as ProjectDoc, warnings: [] };
  }
  if (version === 1 || version === 2) {
    return migrateV1(raw as V1Doc);
  }
  throw new UnsupportedProjectError(version);
}
