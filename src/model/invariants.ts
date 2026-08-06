/**
 * Document invariants, checked after every edit in development.
 *
 * These are the properties the renderer and the edit operations both assume.
 * Each one corresponds to a bug that existed when it was merely assumed:
 *
 * - clips sorted by start: `splitClipAtTime` pushed the new clip to the end of
 *   the array, so render order depended on edit history
 * - clips non-overlapping: `moveClip` had no overlap check, and the compositor
 *   picked whichever overlapping clip it scanned first
 * - in/out within the source: `trimClipRight` clamped only the minimum, so a
 *   clip could be dragged past the end of its media into a silent freeze frame
 * - positive duration: zero-length clips divide by zero in transition progress
 */

import {
  type ProjectDoc,
  type Track,
  type Clip,
  clipEndFrame,
  clipSourceSpan,
  findAsset,
  assetDurationFrames,
} from "./doc";

export interface Violation {
  path: string;
  message: string;
}

function checkClip(
  doc: ProjectDoc,
  track: Track,
  clip: Clip,
  index: number,
  out: Violation[],
): void {
  const path = `tracks[${track.id}].clips[${index}] (${clip.id})`;

  if (!Number.isInteger(clip.startFrame)) {
    out.push({ path, message: `startFrame ${clip.startFrame} is not an integer` });
  }
  if (clip.startFrame < 0) {
    out.push({ path, message: `startFrame ${clip.startFrame} is negative` });
  }
  if (!Number.isInteger(clip.durationFrames)) {
    out.push({
      path,
      message: `durationFrames ${clip.durationFrames} is not an integer`,
    });
  }
  if (clip.durationFrames <= 0) {
    out.push({
      path,
      message: `durationFrames ${clip.durationFrames} must be positive`,
    });
  }
  if (!Number.isInteger(clip.inPointFrames) || clip.inPointFrames < 0) {
    out.push({ path, message: `inPointFrames ${clip.inPointFrames} is invalid` });
  }
  if (!(clip.speed > 0) || !Number.isFinite(clip.speed)) {
    out.push({ path, message: `speed ${clip.speed} must be finite and positive` });
  }
  if (clip.fadeInFrames < 0 || clip.fadeOutFrames < 0) {
    out.push({ path, message: "fade lengths must not be negative" });
  }
  if (clip.fadeInFrames + clip.fadeOutFrames > clip.durationFrames) {
    out.push({ path, message: "fades overlap and exceed the clip length" });
  }

  // A clip must not read past the end of its source.
  if (clip.source.type === "asset") {
    const asset = findAsset(doc, clip.source.assetId);
    if (!asset) {
      out.push({ path, message: `references unknown asset ${clip.source.assetId}` });
    } else {
      const available = assetDurationFrames(asset, doc.sequence.frameRate);
      // null means unknown duration (offline/unprobed) — nothing to check.
      if (available !== null && clip.inPointFrames + clipSourceSpan(clip) > available) {
        out.push({
          path,
          message: `reads source frames ${clip.inPointFrames}..${clip.inPointFrames + clipSourceSpan(clip)} but the asset has ${available}`,
        });
      }
    }
  }
}

function checkTrack(doc: ProjectDoc, track: Track, out: Violation[]): void {
  const clipIds = new Set<string>();

  for (let i = 0; i < track.clips.length; i++) {
    const clip = track.clips[i];

    if (clipIds.has(clip.id)) {
      out.push({
        path: `tracks[${track.id}]`,
        message: `duplicate clip id ${clip.id}`,
      });
    }
    clipIds.add(clip.id);

    checkClip(doc, track, clip, i, out);

    const previous = track.clips[i - 1];
    if (previous) {
      if (clip.startFrame < previous.startFrame) {
        out.push({
          path: `tracks[${track.id}].clips[${i}]`,
          message: "clips are not sorted by startFrame",
        });
      }
      if (clip.startFrame < clipEndFrame(previous)) {
        out.push({
          path: `tracks[${track.id}].clips[${i}]`,
          message: `overlaps the previous clip (starts at ${clip.startFrame}, previous ends at ${clipEndFrame(previous)})`,
        });
      }
    }
  }

  for (const transition of track.transitions) {
    if (!clipIds.has(transition.leftClipId) || !clipIds.has(transition.rightClipId)) {
      out.push({
        path: `tracks[${track.id}].transitions[${transition.id}]`,
        message: "references a clip that is not on this track",
      });
    }
    if (transition.durationFrames <= 0) {
      out.push({
        path: `tracks[${track.id}].transitions[${transition.id}]`,
        message: "duration must be positive",
      });
    }
  }
}

export function validateDoc(doc: ProjectDoc): Violation[] {
  const out: Violation[] = [];

  const rate = doc.sequence.frameRate;
  if (!(rate.num > 0) || !(rate.den > 0)) {
    out.push({ path: "sequence.frameRate", message: "must be a positive ratio" });
  }
  if (doc.sequence.width <= 0 || doc.sequence.height <= 0) {
    out.push({ path: "sequence", message: "width and height must be positive" });
  }

  const assetIds = new Set<string>();
  for (const asset of doc.assets) {
    if (assetIds.has(asset.id)) {
      out.push({ path: "assets", message: `duplicate asset id ${asset.id}` });
    }
    assetIds.add(asset.id);
  }

  const trackIds = new Set<string>();
  for (const track of doc.tracks) {
    if (trackIds.has(track.id)) {
      out.push({ path: "tracks", message: `duplicate track id ${track.id}` });
    }
    trackIds.add(track.id);
    checkTrack(doc, track, out);
  }

  return out;
}

export function isDocValid(doc: ProjectDoc): boolean {
  return validateDoc(doc).length === 0;
}

/**
 * Throws on any violation. Wired into `applyEdit` under `import.meta.env.DEV`
 * so a broken edit surfaces at the operation that caused it rather than as a
 * rendering oddity three actions later.
 */
export function assertDocValid(doc: ProjectDoc, context = "document"): void {
  const violations = validateDoc(doc);
  if (violations.length === 0) return;
  const detail = violations
    .slice(0, 10)
    .map((v) => `  ${v.path}: ${v.message}`)
    .join("\n");
  const more =
    violations.length > 10 ? `\n  ...and ${violations.length - 10} more` : "";
  throw new Error(`Invalid ${context}:\n${detail}${more}`);
}
