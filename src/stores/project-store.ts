/**
 * The project store.
 *
 * `ProjectDoc` plus snapshot history is the single source of truth. Every
 * mutation goes through `applyEdit`, so every mutation is undoable and every
 * mutation is validated.
 *
 * ## The compatibility view
 *
 * `projectState` is a *projection* of the document into the shape the existing
 * panels and renderer expect: seconds instead of frames, `type` instead of
 * `kind`, transitions hanging off the right-hand clip, titles as a
 * `textOverlay` on a `"__text__"` clip. It is rebuilt and reconciled whenever
 * the document changes.
 *
 * This exists so the model rewrite does not have to land at the same time as
 * the timeline and renderer rewrites. It is deliberately temporary: as each
 * consumer is rebuilt it should move to `doc()` and the frame-based API, and
 * when the last one has, this projection and everything marked "compat" below
 * goes away.
 *
 * Writing to the projection does nothing useful — it is overwritten on the next
 * document change. Use the exported operations.
 */

import { createStore, produce, reconcile } from "solid-js/store";
import { create } from "mutative";
import { createSignal, createEffect, batch } from "solid-js";
import {
  type ProjectDoc,
  type Track as DocTrack,
  type Clip as DocClip,
  type Asset,
  type TransitionType,
  type TextStyle,
  createEmptyDoc,
  contentEndFrame,
  snapFrames,
  clipEndFrame,
  findClip,
} from "@/model/doc";
import * as edits from "@/model/edits";
import {
  type HistoryState,
  type ApplyOptions,
  createHistory,
  applyEdit as applyEditToHistory,
  beginInteraction as beginInteractionOn,
  commitInteraction as commitInteractionOn,
  abortInteraction as abortInteractionOn,
  undo as undoHistory,
  redo as redoHistory,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  historyEntries as listHistoryEntries,
  goToEntry as goToHistoryEntry,
  resetHistory,
} from "@/model/history";
import {
  type Animatable,
  type Keyframe as DocKeyframe,
  evaluate,
  setKey,
  removeKey as removeAnimKey,
  clearKeys,
  EASING_PRESETS,
} from "@/lib/animation";
import {
  framesToSeconds,
  secondsToFrames,
  frameRateToNumber,
  type FrameRate,
} from "@/lib/timecode";
import { newId } from "@/model/ids";
import { loadState, createPersistEffect } from "@/lib/persist";

// ── Compatibility types (unchanged shapes the panels still use) ───────

export type KeyframeEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";

export interface Keyframe {
  id: string;
  /** Seconds relative to the clip's start. */
  time: number;
  value: number;
  easing: KeyframeEasing;
}

export interface ClipEffect {
  id: string;
  definitionId: string;
  values: Record<string, number | number[]>;
  keyframes: Record<string, Keyframe[]>;
}

export interface ClipTransition {
  type: TransitionType;
  duration: number;
}

export interface TextOverlay {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  color: string;
  backgroundColor?: string;
  x: number;
  y: number;
  align: "left" | "center" | "right";
}

export interface Clip {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  effects: ClipEffect[];
  transition?: ClipTransition;
  textOverlay?: TextOverlay;
}

export interface Track {
  id: string;
  name: string;
  type: "video" | "audio";
  clips: Clip[];
  muted: boolean;
  locked: boolean;
}

export interface ProjectState {
  name: string;
  tracks: Track[];
  duration: number;
  playheadPosition: number;
  isPlaying: boolean;
  fps: number;
  width: number;
  height: number;
}

/** Sentinel media id the old code used for titles. */
export const TEXT_CLIP_MEDIA_ID = "__text__";

// ── Document state ────────────────────────────────────────────────────

const PROJECT_KEY = "project-doc";

function loadInitialDoc(): ProjectDoc {
  const saved = loadState<ProjectDoc>(PROJECT_KEY);
  if (!saved) return createEmptyDoc();
  try {
    // Autosaved documents are already current-format; a bad one should not
    // prevent the app from starting.
    if (saved.formatVersion === createEmptyDoc().formatVersion) return saved;
  } catch {
    // fall through
  }
  return createEmptyDoc();
}

const [history, setHistory] = createSignal<HistoryState>(
  createHistory(loadInitialDoc()),
);

/** The current document. Read this in new code. */
export function doc(): ProjectDoc {
  return history().present;
}

export function sequenceFrameRate(): FrameRate {
  return doc().sequence.frameRate;
}

// ── Transient playback state ──────────────────────────────────────────
// Not part of the document: a playhead position is not an edit and must not
// be undoable.

const [playheadFrame, setPlayheadFrameSignal] = createSignal(0);
const [isPlaying, setIsPlaying] = createSignal(false);

export { playheadFrame, isPlaying };

export function setPlayheadFrame(frame: number): void {
  setPlayheadFrameSignal(Math.max(0, Math.round(frame)));
}

// ── Edits ─────────────────────────────────────────────────────────────

/**
 * Applies an edit and records one undo step.
 *
 * `recipe` mutates a draft of the document; its return value is ignored.
 */
export function applyEdit(
  label: string,
  recipe: (draft: ProjectDoc) => unknown,
  options: ApplyOptions = {},
): void {
  setHistory((state) => applyEditToHistory(state, label, recipe, options));
}

/** Starts a drag or trim. Edits until `commitInteraction` become one step. */
export function beginInteraction(): void {
  setHistory((state) => beginInteractionOn(state));
}

export function commitInteraction(label: string, icon = "✏️"): void {
  setHistory((state) => commitInteractionOn(state, label, { icon }));
}

export function abortInteraction(): void {
  setHistory((state) => abortInteractionOn(state));
}

export function undo(): boolean {
  const before = history();
  setHistory(undoHistory(before));
  return history() !== before;
}

export function redo(): boolean {
  const before = history();
  setHistory(redoHistory(before));
  return history() !== before;
}

export function canUndo(): boolean {
  return historyCanUndo(history());
}

export function canRedo(): boolean {
  return historyCanRedo(history());
}

export function historyEntries() {
  return listHistoryEntries(history());
}

export function goToEntry(index: number): void {
  setHistory((state) => goToHistoryEntry(state, index));
}

/** Replaces the document wholesale — opening a project, not an edit. */
export function loadDocument(next: ProjectDoc): void {
  batch(() => {
    setHistory(resetHistory(next));
    setPlayheadFrameSignal(0);
    setIsPlaying(false);
  });
}

export function newProject(): void {
  loadDocument(createEmptyDoc());
}

// ── Assets ────────────────────────────────────────────────────────────

/**
 * Adds or updates an asset **without** recording an undo step.
 *
 * Importing media is not a timeline edit. Making it undoable would clutter the
 * history with one entry per file and desync the document from the media pool,
 * which has no undo of its own.
 *
 * A clip may not reference an asset the document does not know about — the
 * invariants reject it — so this must run before any clip using it is created.
 *
 * Known limitation: because the past snapshots predate the registration, an
 * asset registered after an undo is lost on the subsequent redo. It is
 * re-registered the next time the media is used.
 */
export function registerAsset(asset: Asset): void {
  setHistory((state) => {
    const present = create(state.present, (d) => {
      edits.upsertAsset(d, asset);
    });
    return present === state.present ? state : { ...state, present };
  });
}

/** Registers an asset as an undoable edit. Use `registerAsset` for imports. */
export function upsertAsset(asset: Asset): void {
  applyEdit(`Import ${asset.name}`, (d) => edits.upsertAsset(d, asset), {
    icon: "📥",
  });
}

export function assets(): readonly Asset[] {
  return doc().assets;
}

// ── Compatibility projection ──────────────────────────────────────────

function easingFromKeyframe(key: DocKeyframe<number | number[]>): KeyframeEasing {
  if (key.interp === "hold") return "hold";
  if (key.interp === "linear") return "linear";
  // Bezier handles are matched back to the preset they came from so the old
  // easing dropdown still shows something sensible.
  const [ox, oy] = key.out ?? [0, 0];
  for (const [name, preset] of Object.entries(EASING_PRESETS)) {
    if (Math.abs(preset.out[0] - ox) < 0.01 && Math.abs(preset.out[1] - oy) < 0.01) {
      return name as KeyframeEasing;
    }
  }
  return "ease-in-out";
}

function projectEffects(clip: DocClip, rate: FrameRate): ClipEffect[] {
  return clip.effects.map((effect) => {
    const values: Record<string, number | number[]> = {};
    const keyframes: Record<string, Keyframe[]> = {};

    for (const [name, param] of Object.entries(effect.params)) {
      values[name] = param.value;
      if (param.keys?.length) {
        keyframes[name] = param.keys.map((key) => ({
          id: key.id,
          time: framesToSeconds(key.timeFrames, rate),
          value: typeof key.value === "number" ? key.value : 0,
          easing: easingFromKeyframe(key),
        }));
      }
    }

    return { id: effect.id, definitionId: effect.definitionId, values, keyframes };
  });
}

function projectClip(clip: DocClip, track: DocTrack, rate: FrameRate): Clip {
  const startTime = framesToSeconds(clip.startFrame, rate);
  const duration = framesToSeconds(clip.durationFrames, rate);
  const inPoint = framesToSeconds(clip.inPointFrames, rate);

  // Transitions are edges in the document; the old shape hangs them off the
  // clip they transition into.
  const incoming = track.transitions.find((t) => t.rightClipId === clip.id);

  const projected: Clip = {
    id: clip.id,
    mediaId: clip.source.type === "asset" ? clip.source.assetId : TEXT_CLIP_MEDIA_ID,
    trackId: track.id,
    startTime,
    duration,
    inPoint,
    outPoint: inPoint + duration * clip.speed,
    effects: projectEffects(clip, rate),
  };

  if (incoming) {
    projected.transition = {
      type: incoming.type,
      duration: framesToSeconds(incoming.durationFrames, rate),
    };
  }
  if (clip.source.type === "text") {
    projected.textOverlay = { ...clip.source.style };
  }
  return projected;
}

/** Minimum timeline length, so percentage-based geometry never divides by zero. */
const MIN_PROJECTED_DURATION_SEC = 60;
const TAIL_PAD_SEC = 30;

function projectDoc(
  d: ProjectDoc,
): Omit<ProjectState, "playheadPosition" | "isPlaying"> {
  const rate = d.sequence.frameRate;
  return {
    name: d.name,
    tracks: d.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.kind,
      muted: track.muted,
      locked: track.locked,
      clips: track.clips.map((clip) => projectClip(clip, track, rate)),
    })),
    duration: Math.max(
      MIN_PROJECTED_DURATION_SEC,
      framesToSeconds(contentEndFrame(d), rate) + TAIL_PAD_SEC,
    ),
    fps: frameRateToNumber(rate),
    width: d.sequence.width,
    height: d.sequence.height,
  };
}

const [projectState, setProjectState] = createStore<ProjectState>({
  ...projectDoc(doc()),
  playheadPosition: 0,
  isPlaying: false,
});

/**
 * Keeps the projection in sync. `reconcile` with a key means an edit to one
 * clip updates that clip's row rather than replacing every track, so Solid's
 * fine-grained reactivity survives the projection.
 */
export function initProjectPersistence(): void {
  createEffect(() => {
    const projected = projectDoc(doc());
    setProjectState(
      produce((state) => {
        state.name = projected.name;
        state.duration = projected.duration;
        state.fps = projected.fps;
        state.width = projected.width;
        state.height = projected.height;
      }),
    );
    setProjectState("tracks", reconcile(projected.tracks, { key: "id" }));
  });

  createEffect(() => {
    setProjectState(
      "playheadPosition",
      framesToSeconds(playheadFrame(), sequenceFrameRate()),
    );
  });

  createEffect(() => {
    setProjectState("isPlaying", isPlaying());
  });

  createPersistEffect(PROJECT_KEY, () => doc());
}

export { projectState, setProjectState };

// ── Compatibility operations ──────────────────────────────────────────
// Thin wrappers translating the old seconds-based API onto frame-based edits.
// Each one is a single undo step.

function rate(): FrameRate {
  return sequenceFrameRate();
}

function toFrames(seconds: number): number {
  return secondsToFrames(seconds, rate());
}

export function addClipToTrack(
  trackId: string,
  mediaId: string,
  _mediaName: string,
  duration: number,
  startTime?: number,
): Clip | null {
  let createdId: string | undefined;

  applyEdit(
    "Add clip",
    (d) => {
      createdId = edits.insertClip(
        d,
        trackId,
        { type: "asset", assetId: mediaId },
        toFrames(duration),
        {
          startFrame: startTime === undefined ? undefined : toFrames(startTime),
          mode: "fit",
        },
      )?.id;
    },
    { icon: "➕" },
  );

  // Re-read from the committed document: the draft is revoked once the edit
  // lands. Null means the track was locked or the request was invalid.
  const found = createdId ? findClip(doc(), createdId) : undefined;
  return found ? projectClip(found.clip, found.track, rate()) : null;
}

export function removeClip(trackId: string, clipId: string): void {
  applyEdit("Delete clip", (d) => edits.removeClip(d, trackId, clipId), { icon: "🗑" });
}

export function moveClip(trackId: string, clipId: string, newStartTime: number): void {
  applyEdit(
    "Move clip",
    (d) => edits.moveClip(d, trackId, clipId, toFrames(newStartTime)),
    {
      icon: "↔",
      coalesceKey: `move:${clipId}`,
    },
  );
}

export function splitClipAtTime(
  trackId: string,
  clipId: string,
  splitTime: number,
): Clip | null {
  let rightId: string | undefined;
  applyEdit(
    "Split clip",
    (d) => {
      rightId = edits.splitClip(d, trackId, clipId, toFrames(splitTime))?.right.id;
    },
    { icon: "✂" },
  );
  const found = rightId ? findClip(doc(), rightId) : undefined;
  return found ? projectClip(found.clip, found.track, rate()) : null;
}

export function trimClipLeft(
  trackId: string,
  clipId: string,
  newStartTime: number,
): void {
  applyEdit(
    "Trim clip",
    (d) => edits.trimClipStart(d, trackId, clipId, toFrames(newStartTime)),
    { icon: "⟵", coalesceKey: `trimStart:${clipId}` },
  );
}

export function trimClipRight(
  trackId: string,
  clipId: string,
  newEndTime: number,
): void {
  applyEdit(
    "Trim clip",
    (d) => edits.trimClipEnd(d, trackId, clipId, toFrames(newEndTime)),
    {
      icon: "⟶",
      coalesceKey: `trimEnd:${clipId}`,
    },
  );
}

export function getClipAt(trackId: string, time: number): Clip | undefined {
  const track = projectState.tracks.find((t) => t.id === trackId);
  return track?.clips.find(
    (c) => time >= c.startTime && time < c.startTime + c.duration,
  );
}

export function getAllSnapPoints(excludeClipId?: string): number[] {
  const r = rate();
  return snapFrames(doc(), excludeClipId).map((f) => framesToSeconds(f, r));
}

export function snapToNearest(
  time: number,
  threshold: number,
  excludeClipId?: string,
): number {
  let best = time;
  let bestDistance = threshold;
  for (const point of getAllSnapPoints(excludeClipId)) {
    const distance = Math.abs(point - time);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

export function addTrack(type: "video" | "audio"): Track {
  let createdId: string | undefined;
  applyEdit(
    `Add ${type} track`,
    (d) => {
      createdId = edits.addTrack(d, type).id;
    },
    { icon: "➕" },
  );
  const found = doc().tracks.find((t) => t.id === createdId);
  return {
    id: found?.id ?? "",
    name: found?.name ?? "",
    type,
    clips: [],
    muted: false,
    locked: false,
  };
}

export function reorderTrack(trackId: string, toIndex: number): void {
  applyEdit("Reorder tracks", (d) => edits.reorderTrack(d, trackId, toIndex), {
    icon: "↕",
  });
}

export function toggleTrackMute(trackId: string): void {
  const track = doc().tracks.find((t) => t.id === trackId);
  if (!track) return;
  applyEdit(
    track.muted ? "Unmute track" : "Mute track",
    (d) => edits.setTrackFlag(d, trackId, "muted", !track.muted),
    { icon: "🔇" },
  );
}

export function toggleTrackLock(trackId: string): void {
  const track = doc().tracks.find((t) => t.id === trackId);
  if (!track) return;
  applyEdit(
    track.locked ? "Unlock track" : "Lock track",
    (d) => edits.setTrackFlag(d, trackId, "locked", !track.locked),
    { icon: "🔒" },
  );
}

export function setPlayhead(position: number): void {
  setPlayheadFrame(toFrames(position));
}

/**
 * Mirrors the transport's play state into the store.
 *
 * The clock owns whether we are playing; this exists only so the compatibility
 * projection can keep reporting `projectState.isPlaying`.
 */
export function setPlayingMirror(playing: boolean): void {
  setIsPlaying(playing);
}

// ── Effects ───────────────────────────────────────────────────────────

function withClip(d: ProjectDoc, trackId: string, clipId: string): DocClip | undefined {
  return d.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
}

export function addEffectToClip(
  trackId: string,
  clipId: string,
  definitionId: string,
  defaults: Record<string, number | number[]>,
): ClipEffect {
  const id = newId("fx");
  applyEdit(
    "Add effect",
    (d) => {
      const clip = withClip(d, trackId, clipId);
      if (!clip) return;
      const params: Record<string, Animatable<number | number[]>> = {};
      for (const [name, value] of Object.entries(defaults)) params[name] = { value };
      clip.effects.push({ id, definitionId, enabled: true, params });
    },
    { icon: "✨" },
  );
  return { id, definitionId, values: { ...defaults }, keyframes: {} };
}

export function removeEffectFromClip(
  trackId: string,
  clipId: string,
  effectId: string,
): void {
  applyEdit(
    "Remove effect",
    (d) => {
      const clip = withClip(d, trackId, clipId);
      if (clip) clip.effects = clip.effects.filter((e) => e.id !== effectId);
    },
    { icon: "🗑" },
  );
}

export function updateEffectValue(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
  value: number | number[],
): void {
  applyEdit(
    "Adjust effect",
    (d) => {
      const effect = withClip(d, trackId, clipId)?.effects.find(
        (e) => e.id === effectId,
      );
      if (!effect) return;
      const existing = effect.params[uniformName];
      effect.params[uniformName] = { ...existing, value };
    },
    // A slider drag is one undo step, not one per pixel.
    { icon: "🎚", coalesceKey: `effect:${effectId}:${uniformName}` },
  );
}

export function addKeyframe(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
  time: number,
  value: number,
  easing: KeyframeEasing = "linear",
): void {
  applyEdit(
    "Add keyframe",
    (d) => {
      const effect = withClip(d, trackId, clipId)?.effects.find(
        (e) => e.id === effectId,
      );
      if (!effect) return;
      const param = effect.params[uniformName] ?? { value };
      const preset =
        easing === "hold" || easing === "linear" ? undefined : EASING_PRESETS[easing];
      effect.params[uniformName] = setKey(param, {
        id: newId("kf"),
        timeFrames: toFrames(time),
        value,
        interp: easing === "hold" ? "hold" : easing === "linear" ? "linear" : "bezier",
        out: preset ? [...preset.out] : undefined,
        in: preset ? [...preset.in] : undefined,
      });
    },
    { icon: "🔑" },
  );
}

export function removeKeyframe(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
  keyframeId: string,
): void {
  applyEdit(
    "Remove keyframe",
    (d) => {
      const effect = withClip(d, trackId, clipId)?.effects.find(
        (e) => e.id === effectId,
      );
      if (!effect?.params[uniformName]) return;
      effect.params[uniformName] = removeAnimKey(
        effect.params[uniformName],
        keyframeId,
      );
    },
    { icon: "🔑" },
  );
}

export function updateKeyframe(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
  keyframeId: string,
  patch: { value?: number; easing?: KeyframeEasing; time?: number },
): void {
  applyEdit(
    "Edit keyframe",
    (d) => {
      const effect = withClip(d, trackId, clipId)?.effects.find(
        (e) => e.id === effectId,
      );
      const param = effect?.params[uniformName];
      const key = param?.keys?.find((k) => k.id === keyframeId);
      if (!key) return;

      if (patch.value !== undefined) key.value = patch.value;
      if (patch.time !== undefined) key.timeFrames = toFrames(patch.time);
      if (patch.easing !== undefined) {
        key.interp =
          patch.easing === "hold"
            ? "hold"
            : patch.easing === "linear"
              ? "linear"
              : "bezier";
        const preset =
          patch.easing === "hold" || patch.easing === "linear"
            ? undefined
            : EASING_PRESETS[patch.easing];
        key.out = preset ? [...preset.out] : undefined;
        key.in = preset ? [...preset.in] : undefined;
      }
      if (patch.time !== undefined && param?.keys) {
        param.keys.sort((a, b) => a.timeFrames - b.timeFrames);
      }
    },
    { icon: "🔑", coalesceKey: `keyframe:${keyframeId}` },
  );
}

export function removeAllKeyframes(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
): void {
  applyEdit(
    "Clear keyframes",
    (d) => {
      const effect = withClip(d, trackId, clipId)?.effects.find(
        (e) => e.id === effectId,
      );
      if (!effect?.params[uniformName]) return;
      effect.params[uniformName] = clearKeys(effect.params[uniformName], 0);
    },
    { icon: "🔑" },
  );
}

/**
 * Value of an effect parameter at a time, in seconds relative to the clip.
 * Used by the renderer and the Properties panel.
 */
export function getEffectValueAtTime(
  effect: ClipEffect,
  uniformName: string,
  clipRelativeTime: number,
  fallback: number,
): number {
  const keys = effect.keyframes?.[uniformName];
  if (!keys?.length) {
    const value = effect.values[uniformName];
    return typeof value === "number" ? value : fallback;
  }
  return interpolateKeyframes(keys, clipRelativeTime);
}

/** Compat shim for the old keyframe interpolation helper. */
export function interpolateKeyframes(keyframes: Keyframe[], time: number): number {
  if (keyframes.length === 0) return 0;
  const r = rate();
  const param: Animatable<number> = {
    value: keyframes[0].value,
    keys: keyframes.map((k) => ({
      id: k.id,
      timeFrames: secondsToFrames(k.time, r),
      value: k.value,
      interp:
        k.easing === "hold" ? "hold" : k.easing === "linear" ? "linear" : "bezier",
      out:
        k.easing in EASING_PRESETS
          ? [...EASING_PRESETS[k.easing as keyof typeof EASING_PRESETS].out]
          : undefined,
      in:
        k.easing in EASING_PRESETS
          ? [...EASING_PRESETS[k.easing as keyof typeof EASING_PRESETS].in]
          : undefined,
    })),
  };
  return evaluate(param, secondsToFrames(time, r));
}

// ── Transitions ───────────────────────────────────────────────────────

/**
 * Adds a transition into `clipId` from its left neighbour.
 *
 * Returns whether it was created: a transition needs handles on both sides,
 * and the edit refuses rather than producing a freeze frame. The old API
 * always "succeeded" because nothing rendered it.
 */
export function setClipTransition(
  trackId: string,
  clipId: string,
  transition: ClipTransition | undefined,
): boolean {
  if (!transition) {
    removeClipTransition(trackId, clipId);
    return true;
  }

  let created = false;
  applyEdit(
    "Add transition",
    (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      const index = track?.clips.findIndex((c) => c.id === clipId) ?? -1;
      if (!track || index <= 0) return;
      created = !!edits.addTransition(
        d,
        trackId,
        track.clips[index - 1].id,
        clipId,
        transition.type,
        toFrames(transition.duration),
      );
    },
    { icon: "🔀" },
  );
  return created;
}

export function removeClipTransition(trackId: string, clipId: string): void {
  applyEdit(
    "Remove transition",
    (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      const transition = track?.transitions.find((t) => t.rightClipId === clipId);
      if (transition) edits.removeTransition(d, trackId, transition.id);
    },
    { icon: "🔀" },
  );
}

// ── Titles ────────────────────────────────────────────────────────────

const DEFAULT_TEXT_STYLE: TextStyle = {
  text: "Text",
  fontFamily: "sans-serif",
  fontSize: 48,
  fontWeight: "normal",
  color: "#ffffff",
  x: 0.5,
  y: 0.5,
  align: "center",
};

export function addTextClip(
  trackId: string,
  startTime: number,
  duration = 5,
  text = "Title",
): Clip | null {
  let createdId: string | undefined;
  applyEdit(
    "Add title",
    (d) => {
      createdId = edits.insertClip(
        d,
        trackId,
        { type: "text", style: { ...DEFAULT_TEXT_STYLE, text } },
        toFrames(duration),
        { startFrame: toFrames(startTime), mode: "fit" },
      )?.id;
    },
    { icon: "🅣" },
  );
  const found = createdId ? findClip(doc(), createdId) : undefined;
  return found ? projectClip(found.clip, found.track, rate()) : null;
}

export function updateTextOverlay(
  trackId: string,
  clipId: string,
  patch: Partial<TextOverlay>,
): void {
  applyEdit(
    "Edit title",
    (d) => {
      const clip = withClip(d, trackId, clipId);
      if (clip?.source.type !== "text") return;
      Object.assign(clip.source.style, patch);
    },
    { icon: "🅣", coalesceKey: `text:${clipId}` },
  );
}

// ── Re-exports used by the renderer ───────────────────────────────────

export { clipEndFrame, contentEndFrame };
