/**
 * The project store.
 *
 * `ProjectDoc` plus snapshot history is the single source of truth. Every
 * mutation goes through `applyEdit`, so every mutation is undoable and every
 * mutation is validated.
 *
 * A seconds-shaped *projection* of the document used to live here too —
 * seconds instead of frames, `type` instead of `kind`, transitions hanging off
 * the right-hand clip, titles as a `textOverlay` on a `"__text__"` clip —
 * rebuilt and reconciled on every edit. It existed so the model rewrite did
 * not have to land at the same time as rewriting every panel. Every panel
 * reads `doc()` now and the projection is gone.
 *
 * What remains of that era is the handful of seconds-based operations below,
 * which are honest thin wrappers onto frame-based edits rather than a parallel
 * model, and each of which is a single undo step.
 */

import { create } from "mutative";
import { createSignal, batch } from "solid-js";
import {
  type ProjectDoc,
  type Track as DocTrack,
  type Clip as DocClip,
  type Asset,
  type TransitionType,
  type TextStyle,
  createEmptyDoc,
  contentEndFrame,
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
  type Interp,
  evaluate,
  EASING_PRESETS,
  type EasingPreset,
} from "@/lib/animation";
import { framesToSeconds, secondsToFrames, type FrameRate } from "@/lib/timecode";
import { newId } from "@/model/ids";
import { loadState, createPersistEffect } from "@/lib/persist";

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

/**
 * Persistence.
 *
 * This used to also rebuild a whole seconds-shaped projection of the document
 * on every edit, reconciled into a Solid store, so the original panels could
 * keep reading the shape they were written against while the model underneath
 * them changed. Every panel reads `doc()` now, so all of that is gone.
 */
export function initProjectPersistence(): void {
  createPersistEffect(PROJECT_KEY, () => doc());
}

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
): DocClip | null {
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
  return found?.clip ?? null;
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
): DocClip | null {
  let rightId: string | undefined;
  applyEdit(
    "Split clip",
    (d) => {
      rightId = edits.splitClip(d, trackId, clipId, toFrames(splitTime))?.right.id;
    },
    { icon: "✂" },
  );
  const found = rightId ? findClip(doc(), rightId) : undefined;
  return found?.clip ?? null;
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

export function addTrack(type: "video" | "audio"): DocTrack {
  let createdId: string | undefined;
  applyEdit(
    `Add ${type} track`,
    (d) => {
      createdId = edits.addTrack(d, type).id;
    },
    { icon: "➕" },
  );
  // The document is the source of truth; a synthesised stand-in was only ever
  // needed because the old return type was a projected shape.
  return doc().tracks.find((t) => t.id === createdId)!;
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
): string {
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
  return id;
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
  transition: { type: TransitionType; duration: number } | undefined,
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

// ── Animatable parameters ─────────────────────────────────────────────

/** What the panel needs to draw one parameter row. */
export interface ParamView {
  /** The value at the playhead, animation included. */
  value: edits.ParamValue;
  animated: boolean;
  keys: readonly DocKeyframe<edits.ParamValue>[];
  /** Whether a keyframe sits exactly on the playhead. */
  keyedHere: boolean;
  /** Whether the playhead is inside the clip at all. */
  inRange: boolean;
}

function clipOf(trackId: string, clipId: string): DocClip | undefined {
  return doc()
    .tracks.find((t) => t.id === trackId)
    ?.clips.find((c) => c.id === clipId);
}

/** Reads a parameter as the panel sees it: at the playhead. */
export function readParam(
  trackId: string,
  clipId: string,
  target: edits.ParamTarget,
): ParamView | null {
  const clip = clipOf(trackId, clipId);
  if (!clip) return null;
  const param = edits.paramOf(clip, target);
  if (!param) return null;

  const frame = playheadFrame();
  const at = edits.localFrame(clip, frame);
  return {
    value: evaluate(param, at),
    animated: (param.keys?.length ?? 0) > 0,
    keys: param.keys ?? [],
    keyedHere: (param.keys ?? []).some((k) => k.timeFrames === at),
    inRange: at >= 0 && at < clip.durationFrames,
  };
}

/**
 * Sets a parameter at the playhead, coalesced so a slider drag is one undo
 * step. Writes a keyframe when the parameter is animated.
 */
export function writeParam(
  trackId: string,
  clipId: string,
  target: edits.ParamTarget,
  value: edits.ParamValue,
  label = "Adjust",
): void {
  applyEdit(
    label,
    (d) => {
      edits.setParam(d, trackId, clipId, target, value, playheadFrame());
    },
    { icon: "🎛", coalesceKey: `param:${clipId}:${targetKey(target)}` },
  );
}

/** Starts animating a parameter, or stops and freezes it where it stands. */
export function toggleParamAnimation(
  trackId: string,
  clipId: string,
  target: edits.ParamTarget,
): void {
  const view = readParam(trackId, clipId, target);
  if (!view) return;

  applyEdit(
    view.animated ? "Remove keyframes" : "Animate parameter",
    (d) => {
      if (view.animated)
        edits.clearParamKeys(d, trackId, clipId, target, playheadFrame());
      else edits.addParamKey(d, trackId, clipId, target, playheadFrame());
    },
    { icon: "⏱" },
  );
}

/** Adds or removes a keyframe at the playhead. */
export function toggleParamKey(
  trackId: string,
  clipId: string,
  target: edits.ParamTarget,
): void {
  const clip = clipOf(trackId, clipId);
  const view = readParam(trackId, clipId, target);
  if (!clip || !view) return;

  const at = edits.localFrame(clip, playheadFrame());
  const existing = view.keys.find((k) => k.timeFrames === at);

  applyEdit(
    existing ? "Remove keyframe" : "Add keyframe",
    (d) => {
      if (existing) edits.removeParamKey(d, trackId, clipId, target, existing.id);
      else edits.addParamKey(d, trackId, clipId, target, playheadFrame());
    },
    { icon: "⏱" },
  );
}

export function setParamKeyInterp(
  trackId: string,
  clipId: string,
  target: edits.ParamTarget,
  keyId: string,
  interp: Interp,
  preset?: EasingPreset,
): void {
  applyEdit(
    "Set easing",
    (d) => {
      const handles =
        interp === "bezier" ? EASING_PRESETS[preset ?? "ease-in-out"] : undefined;
      edits.setParamKeyInterp(d, trackId, clipId, target, keyId, interp, handles);
    },
    { icon: "📈" },
  );
}

/** Removes every keyframe on a parameter, freezing it at the playhead. */
export function clearParamKeys(
  trackId: string,
  clipId: string,
  target: edits.ParamTarget,
): void {
  applyEdit(
    "Remove keyframes",
    (d) => {
      edits.clearParamKeys(d, trackId, clipId, target, playheadFrame());
    },
    { icon: "⏱" },
  );
}

/** Seeks to the keyframe either side of the playhead, if there is one. */
export function seekToAdjacentKey(
  trackId: string,
  clipId: string,
  target: edits.ParamTarget,
  direction: -1 | 1,
): void {
  const clip = clipOf(trackId, clipId);
  if (!clip) return;
  const keys = edits.paramOf(clip, target)?.keys ?? [];
  const at = edits.localFrame(clip, playheadFrame());

  const candidates = keys
    .filter((k) => (direction < 0 ? k.timeFrames < at : k.timeFrames > at))
    .sort((a, b) =>
      direction < 0 ? b.timeFrames - a.timeFrames : a.timeFrames - b.timeFrames,
    );
  if (candidates.length === 0) return;
  setPlayheadFrame(clip.startFrame + candidates[0].timeFrames);
}

function targetKey(target: edits.ParamTarget): string {
  return target.kind === "clip" ? target.path : `${target.effectId}:${target.uniform}`;
}

/** Fit mode, blend mode, anchor and the enable flag — none of them animatable. */
export function setClipSettings(
  trackId: string,
  clipId: string,
  patch: Parameters<typeof edits.setClipSettings>[3],
): void {
  applyEdit(
    "Change clip settings",
    (d) => {
      edits.setClipSettings(d, trackId, clipId, patch);
    },
    { icon: "🎛" },
  );
}

export function setEffectEnabled(
  trackId: string,
  clipId: string,
  effectId: string,
  enabled: boolean,
): void {
  applyEdit(
    enabled ? "Enable effect" : "Disable effect",
    (d) => {
      edits.setEffectEnabled(d, trackId, clipId, effectId, enabled);
    },
    { icon: "✨" },
  );
}

export function moveEffect(
  trackId: string,
  clipId: string,
  effectId: string,
  toIndex: number,
): void {
  applyEdit(
    "Reorder effects",
    (d) => {
      edits.moveEffect(d, trackId, clipId, effectId, toIndex);
    },
    { icon: "✨" },
  );
}

// ── Per-clip audio ────────────────────────────────────────────────────

/**
 * Volume as a linear gain, 0..2.
 *
 * Goes through the generic setter so that a volume with keyframes gets a
 * keyframe rather than silently having its base value changed underneath the
 * animation.
 */
export function setClipVolume(trackId: string, clipId: string, value: number): void {
  writeParam(
    trackId,
    clipId,
    edits.clipParamPath("volume"),
    Math.max(0, Math.min(2, value)),
    "Set volume",
  );
}

/** Pan from -1 (left) to +1 (right). */
export function setClipPan(trackId: string, clipId: string, value: number): void {
  writeParam(
    trackId,
    clipId,
    edits.clipParamPath("pan"),
    Math.max(-1, Math.min(1, value)),
    "Set pan",
  );
}

export function setClipFade(
  trackId: string,
  clipId: string,
  side: "in" | "out",
  seconds: number,
): void {
  applyEdit(
    side === "in" ? "Set fade in" : "Set fade out",
    (d) => {
      const clip = withClip(d, trackId, clipId);
      if (!clip) return;
      const frames = Math.max(0, Math.min(clip.durationFrames, toFrames(seconds)));
      if (side === "in") clip.fadeInFrames = frames;
      else clip.fadeOutFrames = frames;
      // Fades must not overlap; the later one yields.
      if (clip.fadeInFrames + clip.fadeOutFrames > clip.durationFrames) {
        if (side === "in") clip.fadeOutFrames = clip.durationFrames - clip.fadeInFrames;
        else clip.fadeInFrames = clip.durationFrames - clip.fadeOutFrames;
      }
    },
    { icon: "🎚", coalesceKey: `fade${side}:${clipId}` },
  );
}

/** Whether a video clip contributes its own audio to the mix. */
export function setClipLinkedAudio(
  trackId: string,
  clipId: string,
  linked: boolean,
): void {
  applyEdit(
    linked ? "Attach audio" : "Detach audio",
    (d) => {
      const clip = withClip(d, trackId, clipId);
      if (clip) clip.linkedAudio = linked;
    },
    { icon: "🔗" },
  );
}

/** Per-clip audio settings, in the units the Properties panel shows. */
export function clipAudioSettings(trackId: string, clipId: string) {
  const clip = doc()
    .tracks.find((t) => t.id === trackId)
    ?.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const r = rate();
  return {
    volume: clip.volume.value,
    pan: clip.pan.value,
    fadeInSec: framesToSeconds(clip.fadeInFrames, r),
    fadeOutSec: framesToSeconds(clip.fadeOutFrames, r),
    linkedAudio: clip.linkedAudio,
    maxFadeSec: framesToSeconds(clip.durationFrames, r),
  };
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
): DocClip | null {
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
  return found?.clip ?? null;
}

export function updateTextOverlay(
  trackId: string,
  clipId: string,
  patch: Partial<TextStyle>,
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
