/**
 * Timeline edit operations.
 *
 * Every function here mutates a `mutative` draft of the document and is
 * responsible for leaving it valid: clips sorted by start frame, no overlaps,
 * in/out points inside the source, positive durations. `invariants.ts` checks
 * that in development after each edit.
 *
 * These take a draft rather than returning a new document because they compose
 * — a ripple delete is a remove plus a shift, and both should land in one undo
 * step. `history.applyEdit` owns creating the draft and committing it.
 */

import {
  type ProjectDoc,
  type Track,
  type Clip,
  type ClipSource,
  type Transition,
  type TransitionType,
  type Marker,
  type Asset,
  createClip,
  createTrack,
  clipEndFrame,
  clipSourceSpan,
  cloneClip,
  findAsset,
  assetDurationFrames,
} from "./doc";
import { newId } from "./ids";
import { evaluate, type Animatable, type Interp } from "@/lib/animation";

/** Shortest clip the timeline will produce. One frame is still editable. */
export const MIN_CLIP_FRAMES = 1;

type Draft = ProjectDoc;

// ── Internal helpers ──────────────────────────────────────────────────

function track(doc: Draft, trackId: string): Track | undefined {
  return doc.tracks.find((t) => t.id === trackId);
}

/** A clip by id within a track. */
function findClip(doc: Draft, trackId: string, clipId: string): Clip | undefined {
  return track(doc, trackId)?.clips.find((c) => c.id === clipId);
}

function sortClips(t: Track): void {
  t.clips.sort((a, b) => a.startFrame - b.startFrame);
}

/**
 * Source frames available to a clip, or null when the asset's duration is
 * unknown. Null means "don't clamp" — clamping an unprobed asset to zero would
 * delete the user's clip.
 */
function availableSourceFrames(doc: Draft, clip: Clip): number | null {
  if (clip.source.type !== "asset") return null;
  const asset = findAsset(doc, clip.source.assetId);
  return assetDurationFrames(asset, doc.sequence.frameRate);
}

/** Removes any transition referencing a clip that no longer exists. */
function pruneTransitions(t: Track): void {
  const ids = new Set(t.clips.map((c) => c.id));
  t.transitions = t.transitions.filter(
    (tr) => ids.has(tr.leftClipId) && ids.has(tr.rightClipId),
  );
}

/**
 * In-point that keeps a clip's source range ending exactly where it did.
 *
 * Used whenever the left edge moves — splitting, trimming the head, clearing a
 * range. The obvious formula, `oldIn + round(delta * speed)`, rounds the
 * in-point shift independently of the resulting span; at a fractional speed the
 * two round apart and the clip ends up reading one frame past the end of its
 * media. Anchoring the source *end* makes `in + span` exactly conserved, so
 * that cannot happen.
 *
 * Only clamped at zero. It must be free to move below the original in-point,
 * because trimming the head leftward reveals earlier material — pinning it
 * there while the span grew was itself an overrun.
 */
function anchoredInPoint(parent: Clip, newDurationFrames: number): number {
  const parentSpan = clipSourceSpan(parent);
  const newSpan = Math.round(newDurationFrames * parent.speed);
  return Math.max(0, parent.inPointFrames + parentSpan - newSpan);
}

/**
 * Pulls a clip back inside its source media, shortening it and then, if that
 * is not enough, moving its in-point earlier.
 *
 * The second step matters at high speeds: a clip must be at least one timeline
 * frame long, but at 4x one timeline frame consumes four source frames, so a
 * clip whose in-point sits three frames from the end cannot be shortened enough
 * to fit. Retreating the in-point keeps the clip alive showing the last frames
 * it can, instead of leaving it reading past the end.
 */
function fitToSource(doc: Draft, clip: Clip): void {
  const available = availableSourceFrames(doc, clip);
  if (available === null) return;

  const maxLength = Math.floor((available - clip.inPointFrames) / clip.speed);
  clip.durationFrames = Math.max(
    MIN_CLIP_FRAMES,
    Math.min(clip.durationFrames, maxLength),
  );

  const span = clipSourceSpan(clip);
  if (clip.inPointFrames + span > available) {
    clip.inPointFrames = Math.max(0, available - span);
  }

  // A source shorter than one frame at this speed: slow down rather than
  // produce a clip that cannot be represented.
  if (clip.inPointFrames + clipSourceSpan(clip) > available) {
    clip.speed = Math.max(available / clip.durationFrames, Number.MIN_VALUE);
    clip.inPointFrames = 0;
  }
}

/**
 * Clamps fades so they never exceed the clip. Trimming a clip shorter than its
 * fades would otherwise leave a document that fails validation.
 */
function clampFades(clip: Clip): void {
  clip.fadeInFrames = Math.max(0, Math.min(clip.fadeInFrames, clip.durationFrames));
  clip.fadeOutFrames = Math.max(
    0,
    Math.min(clip.fadeOutFrames, clip.durationFrames - clip.fadeInFrames),
  );
}

/**
 * Frees `[start, start+length)` on a track by trimming or removing whatever
 * occupies it. This is what makes overwrite edits and cross-track moves safe
 * without leaving overlaps behind.
 */
function clearRange(
  t: Track,
  start: number,
  length: number,
  exceptClipId?: string,
): void {
  const end = start + length;
  const kept: Clip[] = [];

  for (const clip of t.clips) {
    if (clip.id === exceptClipId) {
      kept.push(clip);
      continue;
    }
    const clipStart = clip.startFrame;
    const clipEnd = clipEndFrame(clip);

    // No intersection.
    if (clipEnd <= start || clipStart >= end) {
      kept.push(clip);
      continue;
    }

    // Fully covered — drop it.
    if (clipStart >= start && clipEnd <= end) continue;

    // Covered in the middle — split into the surviving head and tail.
    if (clipStart < start && clipEnd > end) {
      const tail = cloneClip(clip, newId("clip"));
      tail.durationFrames = clipEnd - end;
      tail.inPointFrames = anchoredInPoint(clip, tail.durationFrames);
      tail.startFrame = end;
      clampFades(tail);

      clip.durationFrames = start - clipStart;
      clampFades(clip);

      kept.push(clip, tail);
      continue;
    }

    // Overlaps the head of the range — trim its tail back.
    if (clipStart < start) {
      clip.durationFrames = start - clipStart;
      clampFades(clip);
      kept.push(clip);
      continue;
    }

    // Overlaps the tail of the range — trim its head forward. Same anchoring
    // as trimClipStart: the surviving part keeps the parent's source end.
    const remaining = clipEnd - end;
    clip.inPointFrames = anchoredInPoint(clip, remaining);
    clip.startFrame = end;
    clip.durationFrames = remaining;
    clampFades(clip);
    kept.push(clip);
  }

  t.clips = kept;
  sortClips(t);
  pruneTransitions(t);
}

/** First frame at or after `from` with room for `length` frames. */
function findFreeSlot(t: Track, from: number, length: number): number {
  let candidate = Math.max(0, from);
  // Clips are sorted, so one pass suffices: push past anything we collide with.
  for (const clip of t.clips) {
    if (clipEndFrame(clip) <= candidate) continue;
    if (clip.startFrame >= candidate + length) break;
    candidate = clipEndFrame(clip);
  }
  return candidate;
}

// ── Assets ────────────────────────────────────────────────────────────

/** Adds an asset, or updates the existing entry with the same content key. */
export function upsertAsset(doc: Draft, asset: Asset): void {
  const index = doc.assets.findIndex((a) => a.id === asset.id);
  if (index >= 0) doc.assets[index] = { ...doc.assets[index], ...asset };
  else doc.assets.push(asset);
}

export function setAssetProblem(
  doc: Draft,
  assetId: string,
  problem: Asset["problem"],
): void {
  const asset = doc.assets.find((a) => a.id === assetId);
  if (asset) asset.problem = problem;
}

/** Drops assets no clip references. */
export function pruneUnusedAssets(doc: Draft): void {
  const used = new Set<string>();
  for (const t of doc.tracks) {
    for (const clip of t.clips) {
      if (clip.source.type === "asset") used.add(clip.source.assetId);
    }
  }
  doc.assets = doc.assets.filter((a) => used.has(a.id));
}

// ── Clips ─────────────────────────────────────────────────────────────

export interface InsertOptions {
  /** Where to place the clip. Defaults to the first free slot at or after 0. */
  startFrame?: number;
  /** "overwrite" clears whatever is in the way; "fit" finds the next gap. */
  mode?: "overwrite" | "fit";
  inPointFrames?: number;
  overrides?: Partial<Clip>;
}

export function insertClip(
  doc: Draft,
  trackId: string,
  source: ClipSource,
  durationFrames: number,
  options: InsertOptions = {},
): Clip | undefined {
  const t = track(doc, trackId);
  if (!t || t.locked) return undefined;

  const length = Math.max(MIN_CLIP_FRAMES, Math.round(durationFrames));
  const mode = options.mode ?? "fit";
  const requested = Math.max(0, Math.round(options.startFrame ?? 0));

  const clip = createClip(source, requested, length, {
    inPointFrames: Math.max(0, options.inPointFrames ?? 0),
    ...options.overrides,
  });

  // Don't let a new clip read past the end of its source.
  fitToSource(doc, clip);

  if (mode === "overwrite") {
    clearRange(t, clip.startFrame, clip.durationFrames);
  } else {
    clip.startFrame = findFreeSlot(t, requested, clip.durationFrames);
  }

  t.clips.push(clip);
  sortClips(t);
  return clip;
}

export function removeClip(doc: Draft, trackId: string, clipId: string): void {
  const t = track(doc, trackId);
  if (!t || t.locked) return;
  t.clips = t.clips.filter((c) => c.id !== clipId);
  pruneTransitions(t);
}

export function removeClips(
  doc: Draft,
  refs: { trackId: string; clipId: string }[],
): void {
  const byTrack = new Map<string, Set<string>>();
  for (const ref of refs) {
    const set = byTrack.get(ref.trackId) ?? new Set();
    set.add(ref.clipId);
    byTrack.set(ref.trackId, set);
  }
  for (const [trackId, ids] of byTrack) {
    const t = track(doc, trackId);
    if (!t || t.locked) continue;
    t.clips = t.clips.filter((c) => !ids.has(c.id));
    pruneTransitions(t);
  }
}

/**
 * Removes clips and closes the gaps they leave, shifting later clips on the
 * same track earlier by the removed length.
 */
export function rippleDelete(
  doc: Draft,
  refs: { trackId: string; clipId: string }[],
): void {
  const byTrack = new Map<string, Set<string>>();
  for (const ref of refs) {
    const set = byTrack.get(ref.trackId) ?? new Set();
    set.add(ref.clipId);
    byTrack.set(ref.trackId, set);
  }

  for (const [trackId, ids] of byTrack) {
    const t = track(doc, trackId);
    if (!t || t.locked) continue;

    // Process in reverse so each shift is computed against untouched positions.
    const removed = t.clips.filter((c) => ids.has(c.id)).reverse();
    t.clips = t.clips.filter((c) => !ids.has(c.id));

    for (const gone of removed) {
      for (const clip of t.clips) {
        if (clip.startFrame >= clipEndFrame(gone)) {
          clip.startFrame -= gone.durationFrames;
        }
      }
    }
    sortClips(t);
    pruneTransitions(t);
  }
}

export interface MoveOptions {
  /** Target track. Defaults to staying put. Must match the source track kind. */
  toTrackId?: string;
  /** "overwrite" clears the destination; "fit" refuses to overlap. */
  mode?: "overwrite" | "fit";
}

/**
 * Moves a clip, optionally to another track. Cross-track moves were impossible
 * before — `moveClip` only ever changed `startTime` within one track.
 */
export function moveClip(
  doc: Draft,
  trackId: string,
  clipId: string,
  toStartFrame: number,
  options: MoveOptions = {},
): void {
  const from = track(doc, trackId);
  if (!from || from.locked) return;

  const clip = from.clips.find((c) => c.id === clipId);
  if (!clip) return;

  const to = options.toTrackId ? track(doc, options.toTrackId) : from;
  if (!to || to.locked) return;
  // Video clips can't live on audio tracks; the renderer has no path for it.
  if (to.kind !== from.kind) return;

  const target = Math.max(0, Math.round(toStartFrame));

  if (to === from) {
    if (options.mode === "overwrite") {
      clearRange(to, target, clip.durationFrames, clip.id);
      clip.startFrame = target;
    } else {
      // Take the clip out of consideration while looking for its own slot.
      const others = from.clips.filter((c) => c.id !== clipId);
      const probe: Track = { ...from, clips: others };
      clip.startFrame = findFreeSlot(probe, target, clip.durationFrames);
    }
    sortClips(from);
    return;
  }

  from.clips = from.clips.filter((c) => c.id !== clipId);
  pruneTransitions(from);

  if (options.mode === "overwrite") {
    clearRange(to, target, clip.durationFrames);
    clip.startFrame = target;
  } else {
    clip.startFrame = findFreeSlot(to, target, clip.durationFrames);
  }
  to.clips.push(clip);
  sortClips(to);
}

export function nudgeClips(
  doc: Draft,
  refs: { trackId: string; clipId: string }[],
  deltaFrames: number,
): void {
  for (const ref of refs) {
    const t = track(doc, ref.trackId);
    const clip = t?.clips.find((c) => c.id === ref.clipId);
    if (!t || !clip || t.locked) continue;
    moveClip(doc, ref.trackId, ref.clipId, clip.startFrame + deltaFrames);
  }
}

/**
 * Splits a clip at a timeline frame, leaving both halves in place.
 *
 * The right half is inserted next to its sibling and the track re-sorted —
 * `splitClipAtTime` used to push it to the end of the array, so after a few
 * cuts the clip order no longer matched the timeline order.
 */
export function splitClip(
  doc: Draft,
  trackId: string,
  clipId: string,
  atFrame: number,
): { left: Clip; right: Clip } | undefined {
  const t = track(doc, trackId);
  if (!t || t.locked) return undefined;

  const index = t.clips.findIndex((c) => c.id === clipId);
  if (index < 0) return undefined;
  const clip = t.clips[index];

  const offset = Math.round(atFrame) - clip.startFrame;
  // Both halves must survive the minimum length.
  if (offset < MIN_CLIP_FRAMES || offset > clip.durationFrames - MIN_CLIP_FRAMES) {
    return undefined;
  }

  const right = cloneClip(clip, newId("clip"));
  right.startFrame = clip.startFrame + offset;
  right.durationFrames = clip.durationFrames - offset;
  right.inPointFrames = anchoredInPoint(clip, right.durationFrames);
  right.fadeInFrames = 0;

  clip.durationFrames = offset;
  clip.fadeOutFrames = 0;
  clampFades(clip);
  clampFades(right);

  t.clips.splice(index + 1, 0, right);
  sortClips(t);
  return { left: clip, right };
}

/**
 * Drags a clip's left edge. The start and the in-point move together, so the
 * visible content stays put while the clip gets shorter or longer.
 */
export function trimClipStart(
  doc: Draft,
  trackId: string,
  clipId: string,
  toStartFrame: number,
): void {
  const t = track(doc, trackId);
  const clip = t?.clips.find((c) => c.id === clipId);
  if (!t || !clip || t.locked) return;

  const end = clipEndFrame(clip);
  let target = Math.round(toStartFrame);

  // Can't extend past the head of the source.
  const earliestByMedia = clip.startFrame - Math.floor(clip.inPointFrames / clip.speed);
  target = Math.max(target, Math.max(0, earliestByMedia));

  // Can't extend into the previous clip.
  const index = t.clips.indexOf(clip);
  const previous = t.clips[index - 1];
  if (previous) target = Math.max(target, clipEndFrame(previous));

  // Must leave a clip behind.
  target = Math.min(target, end - MIN_CLIP_FRAMES);

  // Trimming the left edge must not move the right edge's source frame.
  // Advancing the in-point by `round(delta * speed)` rounds independently of
  // the shrinking span, so at a fractional speed the two can round apart and
  // the clip ends up reading one frame past the end of its media.
  const remaining = end - target;
  clip.inPointFrames = anchoredInPoint(clip, remaining);
  clip.startFrame = target;
  clip.durationFrames = remaining;
  fitToSource(doc, clip);
  clampFades(clip);
}

/**
 * Drags a clip's right edge.
 *
 * Unlike the original, this clamps the *maximum* as well as the minimum. The
 * old version only enforced a floor, so dragging right forever pushed the
 * out-point past the end of the media and produced a silent freeze frame with
 * no indication anything was wrong.
 */
export function trimClipEnd(
  doc: Draft,
  trackId: string,
  clipId: string,
  toEndFrame: number,
): void {
  const t = track(doc, trackId);
  const clip = t?.clips.find((c) => c.id === clipId);
  if (!t || !clip || t.locked) return;

  let target = Math.round(toEndFrame);

  // Must leave a clip behind.
  target = Math.max(target, clip.startFrame + MIN_CLIP_FRAMES);

  // Can't run past the end of the source.
  const available = availableSourceFrames(doc, clip);
  if (available !== null) {
    const maxLength = Math.floor((available - clip.inPointFrames) / clip.speed);
    target = Math.min(target, clip.startFrame + Math.max(MIN_CLIP_FRAMES, maxLength));
  }

  // Can't run into the next clip.
  const index = t.clips.indexOf(clip);
  const next = t.clips[index + 1];
  if (next) target = Math.min(target, next.startFrame);

  clip.durationFrames = target - clip.startFrame;
  clampFades(clip);
}

/**
 * Slip: shifts which part of the source a clip shows, without moving the clip
 * or changing its length.
 */
export function slipClip(
  doc: Draft,
  trackId: string,
  clipId: string,
  deltaFrames: number,
): void {
  const t = track(doc, trackId);
  const clip = t?.clips.find((c) => c.id === clipId);
  if (!t || !clip || t.locked) return;

  const available = availableSourceFrames(doc, clip);
  const span = clipSourceSpan(clip);
  const maxIn = available === null ? Infinity : Math.max(0, available - span);
  clip.inPointFrames = Math.max(
    0,
    Math.min(maxIn, clip.inPointFrames + Math.round(deltaFrames * clip.speed)),
  );
}

/**
 * Slide: moves a clip along the timeline, absorbing the shift into its
 * neighbours so the overall arrangement keeps its length.
 */
export function slideClip(
  doc: Draft,
  trackId: string,
  clipId: string,
  deltaFrames: number,
): void {
  const t = track(doc, trackId);
  if (!t || t.locked) return;

  const index = t.clips.findIndex((c) => c.id === clipId);
  if (index < 0) return;

  const clip = t.clips[index];
  const previous = t.clips[index - 1];
  const next = t.clips[index + 1];

  let delta = Math.round(deltaFrames);

  // Bounded by how much each neighbour can give up before vanishing...
  if (previous) {
    delta = Math.max(delta, -(previous.durationFrames - MIN_CLIP_FRAMES));
  } else {
    delta = Math.max(delta, -clip.startFrame);
  }
  if (next) delta = Math.min(delta, next.durationFrames - MIN_CLIP_FRAMES);

  // ...and by how much source material each has to grow into. Sliding right
  // lengthens the previous clip, which needs frames past its out point;
  // sliding left lengthens the next clip, which needs frames before its in
  // point. Clamping the in-point afterwards instead would leave the clip
  // reading past the end of its media.
  if (previous) {
    const available = availableSourceFrames(doc, previous);
    if (available !== null) {
      const headroom = available - (previous.inPointFrames + clipSourceSpan(previous));
      delta = Math.min(delta, Math.floor(headroom / previous.speed));
    }
  }
  if (next) {
    delta = Math.max(delta, -Math.floor(next.inPointFrames / next.speed));
  }

  if (delta === 0) return;

  clip.startFrame += delta;

  if (previous) {
    previous.durationFrames += delta;
    clampFades(previous);
  }
  if (next) {
    next.startFrame += delta;
    next.durationFrames -= delta;
    // Shrinking the in-point by exactly what the duration grows keeps the
    // clip's out point on the same source frame.
    next.inPointFrames += Math.round(delta * next.speed);
    clampFades(next);
  }
  sortClips(t);
}

/** Sets playback speed, keeping the clip's start fixed and rescaling its length. */
export function setClipSpeed(
  doc: Draft,
  trackId: string,
  clipId: string,
  speed: number,
): void {
  const t = track(doc, trackId);
  const clip = t?.clips.find((c) => c.id === clipId);
  if (!t || !clip || t.locked || !(speed > 0) || !Number.isFinite(speed)) return;

  const sourceSpan = clipSourceSpan(clip);
  clip.speed = speed;
  clip.durationFrames = Math.max(MIN_CLIP_FRAMES, Math.round(sourceSpan / speed));

  // Rounding the new length can consume one more source frame than the clip
  // had, so re-fit against the media rather than trusting the division.
  fitToSource(doc, clip);

  // Slowing a clip lengthens it, which may run it into its neighbour.
  const index = t.clips.indexOf(clip);
  const next = t.clips[index + 1];
  if (next) {
    clip.durationFrames = Math.max(
      MIN_CLIP_FRAMES,
      Math.min(clip.durationFrames, next.startFrame - clip.startFrame),
    );
  }
  clampFades(clip);
}

// ── Transitions ───────────────────────────────────────────────────────

/**
 * Adds a transition between two adjacent clips.
 *
 * Returns undefined when the clips aren't neighbours or lack the source
 * material to overlap. A transition needs *handles* — frames beyond the visible
 * in/out — and silently producing a freeze frame instead is worse than
 * refusing.
 */
export function addTransition(
  doc: Draft,
  trackId: string,
  leftClipId: string,
  rightClipId: string,
  type: TransitionType,
  durationFrames: number,
): Transition | undefined {
  const t = track(doc, trackId);
  if (!t || t.locked) return undefined;

  const leftIndex = t.clips.findIndex((c) => c.id === leftClipId);
  const rightIndex = t.clips.findIndex((c) => c.id === rightClipId);
  if (leftIndex < 0 || rightIndex !== leftIndex + 1) return undefined;

  const left = t.clips[leftIndex];
  const right = t.clips[rightIndex];
  // Only butt-joined clips can cross-fade.
  if (clipEndFrame(left) !== right.startFrame) return undefined;

  let length = Math.max(1, Math.round(durationFrames));
  // Neither side may be consumed entirely by the overlap.
  length = Math.min(
    length,
    left.durationFrames - MIN_CLIP_FRAMES,
    right.durationFrames - MIN_CLIP_FRAMES,
  );

  // Handles: the left clip needs frames after its out point, the right needs
  // frames before its in point.
  const leftAvailable = availableSourceFrames(doc, left);
  if (leftAvailable !== null) {
    const used = left.inPointFrames + clipSourceSpan(left);
    length = Math.min(length, Math.floor((leftAvailable - used) / left.speed));
  }
  length = Math.min(length, Math.floor(right.inPointFrames / right.speed));

  if (length < 1) return undefined;

  const existing = t.transitions.findIndex(
    (tr) => tr.leftClipId === leftClipId && tr.rightClipId === rightClipId,
  );
  const transition: Transition = {
    id: existing >= 0 ? t.transitions[existing].id : newId("xf"),
    leftClipId,
    rightClipId,
    type,
    durationFrames: length,
  };
  if (existing >= 0) t.transitions[existing] = transition;
  else t.transitions.push(transition);

  return transition;
}

export function removeTransition(
  doc: Draft,
  trackId: string,
  transitionId: string,
): void {
  const t = track(doc, trackId);
  if (!t) return;
  t.transitions = t.transitions.filter((tr) => tr.id !== transitionId);
}

// ── Tracks ────────────────────────────────────────────────────────────

export function addTrack(doc: Draft, kind: "video" | "audio", name?: string): Track {
  const count = doc.tracks.filter((t) => t.kind === kind).length + 1;
  const t = createTrack(
    kind,
    name ?? `${kind === "video" ? "Video" : "Audio"} ${count}`,
  );
  doc.tracks.push(t);
  return t;
}

export function removeTrack(doc: Draft, trackId: string): void {
  doc.tracks = doc.tracks.filter((t) => t.id !== trackId);
}

export function reorderTrack(doc: Draft, trackId: string, toIndex: number): void {
  const from = doc.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return;
  const clamped = Math.max(0, Math.min(doc.tracks.length - 1, toIndex));
  const [moved] = doc.tracks.splice(from, 1);
  doc.tracks.splice(clamped, 0, moved);
}

export function setTrackFlag(
  doc: Draft,
  trackId: string,
  flag: "muted" | "soloed" | "locked",
  value: boolean,
): void {
  const t = track(doc, trackId);
  if (t) t[flag] = value;
}

export function setTrackHeight(doc: Draft, trackId: string, heightPx: number): void {
  const t = track(doc, trackId);
  if (t) t.heightPx = Math.max(24, Math.min(320, Math.round(heightPx)));
}

// ── Markers ───────────────────────────────────────────────────────────

export function addMarker(
  doc: Draft,
  frame: number,
  name = "",
  color = "#facc15",
): Marker {
  const marker: Marker = {
    id: newId("marker"),
    frame: Math.max(0, Math.round(frame)),
    name,
    color,
  };
  doc.markers.push(marker);
  doc.markers.sort((a, b) => a.frame - b.frame);
  return marker;
}

export function removeMarker(doc: Draft, markerId: string): void {
  doc.markers = doc.markers.filter((m) => m.id !== markerId);
}

export function updateMarker(
  doc: Draft,
  markerId: string,
  patch: Partial<Marker>,
): void {
  const marker = doc.markers.find((m) => m.id === markerId);
  if (!marker) return;
  Object.assign(marker, patch);
  if (patch.frame !== undefined) {
    marker.frame = Math.max(0, Math.round(patch.frame));
    doc.markers.sort((a, b) => a.frame - b.frame);
  }
}

// ── Sequence ──────────────────────────────────────────────────────────

// ── Animatable parameters ─────────────────────────────────────────────

/**
 * The animatable numeric properties of a clip, addressed by path.
 *
 * One string per property rather than a setter per property: the panel needs
 * to render a dozen near-identical rows, and every one of them wants the same
 * operations (read, set, key, unkey, ease). Twelve setters would be twelve
 * chances to forget the keyframe branch — which is how the original panel
 * ended up with static divs reading "100%".
 */
export const CLIP_PARAM_PATHS = [
  "opacity",
  "volume",
  "pan",
  "transform.x",
  "transform.y",
  "transform.scaleX",
  "transform.scaleY",
  "transform.rotation",
  "crop.left",
  "crop.right",
  "crop.top",
  "crop.bottom",
] as const;

export type ClipParamPath = (typeof CLIP_PARAM_PATHS)[number];

/**
 * Anything the properties panel can animate.
 *
 * Effect uniforms and clip properties are the same kind of thing — an
 * `Animatable` hanging off a clip — so they get one set of operations and the
 * panel gets one row component. They used to have two parallel APIs, one of
 * which spoke seconds.
 */
export type ParamTarget =
  | { kind: "clip"; path: ClipParamPath }
  | { kind: "effect"; effectId: string; uniform: string };

export function clipParamPath(path: ClipParamPath): ParamTarget {
  return { kind: "clip", path };
}

export function effectParam(effectId: string, uniform: string): ParamTarget {
  return { kind: "effect", effectId, uniform };
}

/** The `Animatable` a clip path names. */
function paramAtPath(clip: Clip, path: ClipParamPath): Animatable<number> {
  switch (path) {
    case "opacity":
      return clip.opacity;
    case "volume":
      return clip.volume;
    case "pan":
      return clip.pan;
    case "transform.x":
      return clip.transform.x;
    case "transform.y":
      return clip.transform.y;
    case "transform.scaleX":
      return clip.transform.scaleX;
    case "transform.scaleY":
      return clip.transform.scaleY;
    case "transform.rotation":
      return clip.transform.rotation;
    case "crop.left":
      return clip.crop.left;
    case "crop.right":
      return clip.crop.right;
    case "crop.top":
      return clip.crop.top;
    case "crop.bottom":
      return clip.crop.bottom;
  }
}

export type ParamValue = number | number[];

/** The `Animatable` a target names, or undefined if the effect is gone. */
export function paramOf(
  clip: Clip,
  target: ParamTarget,
): Animatable<ParamValue> | undefined {
  if (target.kind === "clip") return paramAtPath(clip, target.path);
  const effect = clip.effects.find((e) => e.id === target.effectId);
  return effect?.params[target.uniform];
}

/**
 * Frames from the clip's own start — the space keyframes live in.
 *
 * Keyframes are clip-relative so that moving a clip along the timeline carries
 * its animation with it.
 */
export function localFrame(clip: Clip, timelineFrame: number): number {
  return timelineFrame - clip.startFrame;
}

/** The value a target has at a timeline frame, animation included. */
export function paramValueAt(
  clip: Clip,
  target: ParamTarget,
  timelineFrame: number,
): ParamValue | undefined {
  const param = paramOf(clip, target);
  if (!param) return undefined;
  return evaluate(param, localFrame(clip, timelineFrame));
}

/**
 * Sets a parameter at a frame.
 *
 * If the parameter is animated the value lands on a keyframe at that frame,
 * creating one if there isn't one yet; if it isn't, it changes the constant.
 * That is what every NLE does, and it is why a single "set" serves the whole
 * panel.
 */
export function setParam(
  doc: Draft,
  trackId: string,
  clipId: string,
  target: ParamTarget,
  value: ParamValue,
  timelineFrame = 0,
): void {
  const clip = findClip(doc, trackId, clipId);
  if (!clip) return;
  const param = paramOf(clip, target);
  if (!param) return;

  if (!param.keys || param.keys.length === 0) {
    param.value = value;
    return;
  }

  const at = localFrame(clip, timelineFrame);
  const existing = param.keys.find((k) => k.timeFrames === at);
  if (existing) {
    existing.value = value;
    return;
  }
  param.keys.push({
    id: newId("key"),
    timeFrames: at,
    value,
    // Matching the neighbour keeps the curve's character when a key is added
    // in the middle of an ease.
    interp: nearestInterp(param, at),
  });
  param.keys.sort((a, b) => a.timeFrames - b.timeFrames);
}

/** The interpolation of the key just before `at`, defaulting to linear. */
function nearestInterp(param: Animatable<ParamValue>, at: number): Interp {
  let best: Interp = "linear";
  for (const key of param.keys ?? []) {
    if (key.timeFrames <= at) best = key.interp;
  }
  return best;
}

/**
 * Adds a keyframe at a frame, holding whatever the parameter shows there.
 *
 * Pressing the stopwatch must not change the picture — the first key captures
 * the current value rather than resetting to a default.
 */
export function addParamKey(
  doc: Draft,
  trackId: string,
  clipId: string,
  target: ParamTarget,
  timelineFrame: number,
  interp: Interp = "linear",
): void {
  const clip = findClip(doc, trackId, clipId);
  if (!clip) return;
  const param = paramOf(clip, target);
  if (!param) return;

  const at = localFrame(clip, timelineFrame);
  const value = evaluate(param, at);

  param.keys ??= [];
  const existing = param.keys.find((k) => k.timeFrames === at);
  if (existing) {
    existing.value = value;
    existing.interp = interp;
    return;
  }
  param.keys.push({ id: newId("key"), timeFrames: at, value, interp });
  param.keys.sort((a, b) => a.timeFrames - b.timeFrames);
}

export function removeParamKey(
  doc: Draft,
  trackId: string,
  clipId: string,
  target: ParamTarget,
  keyId: string,
): void {
  const clip = findClip(doc, trackId, clipId);
  if (!clip) return;
  const param = paramOf(clip, target);
  if (!param?.keys) return;
  param.keys = param.keys.filter((k) => k.id !== keyId);
  // An empty array still reads as animated, which leaves the stopwatch lit
  // with nothing behind it.
  if (param.keys.length === 0) delete param.keys;
}

/** Changes a key's interpolation, and its bezier handles when it has them. */
export function setParamKeyInterp(
  doc: Draft,
  trackId: string,
  clipId: string,
  target: ParamTarget,
  keyId: string,
  interp: Interp,
  handles?: { out?: [number, number]; in?: [number, number] },
): void {
  const clip = findClip(doc, trackId, clipId);
  if (!clip) return;
  const key = paramOf(clip, target)?.keys?.find((k) => k.id === keyId);
  if (!key) return;
  key.interp = interp;
  if (handles?.out) key.out = handles.out;
  if (handles?.in) key.in = handles.in;
}

/**
 * Removes all animation from a parameter, freezing it at what it showed.
 *
 * Freezing rather than reverting to the base value is the non-destructive
 * choice: turning animation off should not move the picture.
 */
export function clearParamKeys(
  doc: Draft,
  trackId: string,
  clipId: string,
  target: ParamTarget,
  timelineFrame: number,
): void {
  const clip = findClip(doc, trackId, clipId);
  if (!clip) return;
  const param = paramOf(clip, target);
  if (!param?.keys || param.keys.length === 0) return;
  param.value = evaluate(param, localFrame(clip, timelineFrame));
  delete param.keys;
}

/** The non-animatable clip settings, which are a plain patch. */
export function setClipSettings(
  doc: Draft,
  trackId: string,
  clipId: string,
  patch: Partial<Pick<Clip, "fit" | "blend" | "enabled" | "linkedAudio">> & {
    anchorX?: number;
    anchorY?: number;
  },
): void {
  const clip = findClip(doc, trackId, clipId);
  if (!clip) return;
  if (patch.fit !== undefined) clip.fit = patch.fit;
  if (patch.blend !== undefined) clip.blend = patch.blend;
  if (patch.enabled !== undefined) clip.enabled = patch.enabled;
  if (patch.linkedAudio !== undefined) clip.linkedAudio = patch.linkedAudio;
  if (patch.anchorX !== undefined) clip.transform.anchorX = patch.anchorX;
  if (patch.anchorY !== undefined) clip.transform.anchorY = patch.anchorY;
}

/** Enables or disables one effect on a clip. */
export function setEffectEnabled(
  doc: Draft,
  trackId: string,
  clipId: string,
  effectId: string,
  enabled: boolean,
): void {
  const effect = findClip(doc, trackId, clipId)?.effects.find((e) => e.id === effectId);
  if (effect) effect.enabled = enabled;
}

/** Moves an effect within a clip's chain. Order changes the picture. */
export function moveEffect(
  doc: Draft,
  trackId: string,
  clipId: string,
  effectId: string,
  toIndex: number,
): void {
  const clip = findClip(doc, trackId, clipId);
  if (!clip) return;
  const from = clip.effects.findIndex((e) => e.id === effectId);
  if (from < 0) return;
  const target = Math.max(0, Math.min(clip.effects.length - 1, toIndex));
  const [effect] = clip.effects.splice(from, 1);
  clip.effects.splice(target, 0, effect);
}

export function setSequence(doc: Draft, patch: Partial<ProjectDoc["sequence"]>): void {
  Object.assign(doc.sequence, patch);
}

export function renameProject(doc: Draft, name: string): void {
  doc.name = name;
}
