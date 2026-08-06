import { createStore } from "solid-js/store";
import { loadState, createPersistEffect } from "@/lib/persist";

const PROJECT_KEY = "project";

export interface MediaItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  path: string;
  duration?: number;
  width?: number;
  height?: number;
  fileHandle?: FileSystemFileHandle;
}

export type KeyframeEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "hold";

export interface Keyframe {
  id: string;
  time: number; // seconds relative to clip start
  value: number;
  easing: KeyframeEasing;
}

export interface ClipEffect {
  id: string;
  definitionId: string;
  values: Record<string, number | number[]>;
  keyframes: Record<string, Keyframe[]>; // uniformName -> sorted keyframes
}

export interface ClipTransition {
  type: "crossfade" | "dip-to-black" | "wipe-left" | "wipe-right";
  duration: number; // seconds
}

export interface TextOverlay {
  text: string;
  fontFamily: string;
  fontSize: number; // px
  fontWeight: "normal" | "bold";
  color: string; // hex
  backgroundColor?: string;
  x: number; // 0..1 normalized position
  y: number; // 0..1 normalized position
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
  transition?: ClipTransition; // transition INTO this clip from the previous one
  textOverlay?: TextOverlay; // for title/text clips (mediaId = "__text__")
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
  media: MediaItem[];
  duration: number;
  playheadPosition: number;
  isPlaying: boolean;
  fps: number;
  width: number;
  height: number;
}

/** Fields persisted to localStorage (excludes transient playback state). */
interface PersistedProjectState {
  name: string;
  tracks: Track[];
  media: MediaItem[];
  duration: number;
  fps: number;
  width: number;
  height: number;
}

function getDefaultProjectState(): ProjectState {
  return {
    name: "Untitled Project",
    tracks: [
      {
        id: "v1",
        name: "Video 1",
        type: "video",
        clips: [],
        muted: false,
        locked: false,
      },
      {
        id: "v2",
        name: "Video 2",
        type: "video",
        clips: [],
        muted: false,
        locked: false,
      },
      {
        id: "a1",
        name: "Audio 1",
        type: "audio",
        clips: [],
        muted: false,
        locked: false,
      },
      {
        id: "a2",
        name: "Audio 2",
        type: "audio",
        clips: [],
        muted: false,
        locked: false,
      },
    ],
    media: [],
    duration: 300,
    playheadPosition: 0,
    isPlaying: false,
    fps: 30,
    width: 1920,
    height: 1080,
  };
}

function loadProjectState(): ProjectState {
  const saved = loadState<PersistedProjectState>(PROJECT_KEY);
  const defaults = getDefaultProjectState();
  if (!saved) return defaults;

  return {
    ...defaults,
    name: saved.name ?? defaults.name,
    tracks: (saved.tracks ?? defaults.tracks).map((t) => ({
      ...t,
      clips: t.clips.map((c) => ({
        ...c,
        effects: c.effects.map((e) => ({ ...e, keyframes: e.keyframes ?? {} })),
      })),
    })),
    media: (saved.media ?? []).map((m) => ({ ...m, fileHandle: undefined })),
    duration: saved.duration ?? defaults.duration,
    fps: saved.fps ?? defaults.fps,
    width: saved.width ?? defaults.width,
    height: saved.height ?? defaults.height,
    // Transient — always reset
    playheadPosition: 0,
    isPlaying: false,
  };
}

const [projectState, setProjectState] =
  createStore<ProjectState>(loadProjectState());

/** Call once inside a reactive root (e.g. App onMount) to enable auto-save. */
export function initProjectPersistence(): void {
  createPersistEffect(
    PROJECT_KEY,
    (): PersistedProjectState => ({
      name: projectState.name,
      tracks: projectState.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({ ...c })),
      })),
      media: projectState.media.map(
        ({ fileHandle, ...rest }) => rest as MediaItem,
      ),
      duration: projectState.duration,
      fps: projectState.fps,
      width: projectState.width,
      height: projectState.height,
    }),
  );
}

// ── Mutations ─────────────────────────────────────────────────────────

let clipIdCounter = 0;

export function addClipToTrack(
  trackId: string,
  mediaId: string,
  mediaName: string,
  duration: number,
  startTime?: number,
): Clip {
  const track = projectState.tracks.find((t) => t.id === trackId);
  // Default startTime: end of last clip on this track
  const lastClipEnd = track
    ? track.clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
    : 0;
  const st = startTime ?? lastClipEnd;

  const clip: Clip = {
    id: `clip-${Date.now()}-${clipIdCounter++}`,
    mediaId,
    trackId,
    startTime: st,
    duration,
    inPoint: 0,
    outPoint: duration,
    effects: [],
  };

  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (clips) => [...clips, clip],
  );

  // Extend project duration if needed
  const newEnd = st + duration;
  if (newEnd > projectState.duration) {
    setProjectState("duration", newEnd + 30); // pad 30s
  }

  // Preload frame source for preview rendering
  import("@/stores/media-store").then(({ mediaState }) => {
    const entry = mediaState.entries.find((e: any) => e.id === mediaId);
    if (entry) {
      import("@/renderer/frame-source").then(({ getFrameSource }) => {
        getFrameSource(entry).catch(() => {});
      });
    }
  });

  // Auto-create linked audio clip when a video with audio is added to a video track
  if (track?.type === "video" && mediaId !== "__text__") {
    import("@/stores/media-store").then(({ mediaState }) => {
      const entry = mediaState.entries.find((e: any) => e.id === mediaId);
      if (entry?.hasAudio || entry?.type === "video") {
        // Find first audio track
        const audioTrack = projectState.tracks.find((t) => t.type === "audio");
        if (audioTrack) {
          const audioClip: Clip = {
            id: `clip-${Date.now()}-${clipIdCounter++}`,
            mediaId,
            trackId: audioTrack.id,
            startTime: st,
            duration,
            inPoint: 0,
            outPoint: duration,
            effects: [],
          };
          setProjectState(
            "tracks",
            (t) => t.id === audioTrack.id,
            "clips",
            (clips) => [...clips, audioClip],
          );
        }
      }
    });
  }

  return clip;
}

export function removeClip(trackId: string, clipId: string): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (clips) => clips.filter((c) => c.id !== clipId),
  );
}

export function moveClip(
  trackId: string,
  clipId: string,
  newStartTime: number,
): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "startTime",
    Math.max(0, newStartTime),
  );
}

export function splitClipAtTime(
  trackId: string,
  clipId: string,
  splitTime: number,
): Clip | null {
  const track = projectState.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!clip) return null;

  const relativeTime = splitTime - clip.startTime;
  if (relativeTime <= 0.1 || relativeTime >= clip.duration - 0.1) return null;

  // Shorten original clip
  const originalDuration = clip.duration;
  const originalOutPoint = clip.outPoint;

  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "duration",
    relativeTime,
  );
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "outPoint",
    clip.inPoint + relativeTime,
  );

  // Create new clip for the right portion
  const newClip: Clip = {
    id: `clip-${Date.now()}-${clipIdCounter++}`,
    mediaId: clip.mediaId,
    trackId,
    startTime: splitTime,
    duration: originalDuration - relativeTime,
    inPoint: clip.inPoint + relativeTime,
    outPoint: originalOutPoint,
    effects: [...clip.effects],
  };

  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (clips) => [...clips, newClip],
  );

  return newClip;
}

export function trimClipLeft(
  trackId: string,
  clipId: string,
  newStartTime: number,
): void {
  const track = projectState.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!clip) return;

  const minStart = clip.startTime + clip.inPoint;
  const maxStart = clip.startTime + clip.duration - 0.1;
  const clamped = Math.max(
    Math.min(newStartTime, maxStart),
    clip.startTime - clip.inPoint,
  );

  const delta = clamped - clip.startTime;

  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "startTime",
    clamped,
  );
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "inPoint",
    clip.inPoint + delta,
  );
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "duration",
    clip.duration - delta,
  );
}

export function trimClipRight(
  trackId: string,
  clipId: string,
  newEndTime: number,
): void {
  const track = projectState.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!clip) return;

  const minEnd = clip.startTime + 0.1;
  const clamped = Math.max(newEndTime, minEnd);
  const newDuration = clamped - clip.startTime;

  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "duration",
    newDuration,
  );
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "outPoint",
    clip.inPoint + newDuration,
  );
}

export function getClipAt(trackId: string, time: number): Clip | undefined {
  const track = projectState.tracks.find((t) => t.id === trackId);
  return track?.clips.find(
    (c) => time >= c.startTime && time < c.startTime + c.duration,
  );
}

export function getAllSnapPoints(): number[] {
  const points: number[] = [0, projectState.playheadPosition];
  for (const track of projectState.tracks) {
    for (const clip of track.clips) {
      points.push(clip.startTime);
      points.push(clip.startTime + clip.duration);
    }
  }
  return [...new Set(points)].sort((a, b) => a - b);
}

export function snapToNearest(
  time: number,
  threshold: number = 0.5,
  excludeClipId?: string,
): number {
  const points = getAllSnapPoints().filter((p) => {
    if (excludeClipId) {
      // Don't snap to own edges
      for (const track of projectState.tracks) {
        const clip = track.clips.find((c) => c.id === excludeClipId);
        if (
          clip &&
          (p === clip.startTime || p === clip.startTime + clip.duration)
        ) {
          return false;
        }
      }
    }
    return true;
  });

  let closest = time;
  let minDist = threshold;
  for (const p of points) {
    const dist = Math.abs(time - p);
    if (dist < minDist) {
      minDist = dist;
      closest = p;
    }
  }
  return closest;
}

export function addTrack(type: "video" | "audio"): Track {
  const existing = projectState.tracks.filter((t) => t.type === type);
  const num = existing.length + 1;
  const track: Track = {
    id: `${type[0]}${num}-${Date.now()}`,
    name: `${type === "video" ? "Video" : "Audio"} ${num}`,
    type,
    clips: [],
    muted: false,
    locked: false,
  };
  setProjectState("tracks", (prev) => [...prev, track]);
  return track;
}

export function reorderTrack(trackId: string, toIndex: number): void {
  const fromIndex = projectState.tracks.findIndex((t) => t.id === trackId);
  if (fromIndex === -1 || fromIndex === toIndex) return;
  const clamped = Math.max(
    0,
    Math.min(toIndex, projectState.tracks.length - 1),
  );
  setProjectState("tracks", (prev) => {
    const next = [...prev];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(clamped, 0, moved);
    return next;
  });
}

export function setPlayhead(position: number): void {
  setProjectState(
    "playheadPosition",
    Math.max(0, Math.min(position, projectState.duration)),
  );
}

export function togglePlayback(): void {
  setProjectState("isPlaying", !projectState.isPlaying);
}

export function toggleTrackMute(trackId: string): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "muted",
    (m) => !m,
  );
}

export function toggleTrackLock(trackId: string): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "locked",
    (l) => !l,
  );
}

// ── Effect mutations ─────────────────────────────────────────────────

let effectIdCounter = 0;

export function addEffectToClip(
  trackId: string,
  clipId: string,
  definitionId: string,
  defaultValues: Record<string, number | number[]> = {},
): ClipEffect {
  const effect: ClipEffect = {
    id: `fx-${Date.now()}-${effectIdCounter++}`,
    definitionId,
    values: { ...defaultValues },
    keyframes: {},
  };

  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "effects",
    (effects) => [...effects, effect],
  );

  return effect;
}

export function removeEffectFromClip(
  trackId: string,
  clipId: string,
  effectId: string,
): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "effects",
    (effects) => effects.filter((e) => e.id !== effectId),
  );
}

export function updateEffectValue(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
  value: number | number[],
): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "effects",
    (e) => e.id === effectId,
    "values",
    (prev) => ({ ...prev, [uniformName]: value }),
  );
}

// ── Keyframe mutations ────────────────────────────────────────────────

let keyframeIdCounter = 0;

/**
 * Helper: update the keyframes record on an effect.  We use index-based
 * paths and unwrap store proxies to plain objects before passing to the
 * updater — predicate-chain selectors with store proxies can miss
 * dynamic-key additions on deeply-nested objects.
 */
function mutateEffectKeyframes(
  trackId: string,
  clipId: string,
  effectId: string,
  updater: (
    keyframes: Record<string, Keyframe[]>,
  ) => Record<string, Keyframe[]>,
): void {
  const trackIdx = projectState.tracks.findIndex((t) => t.id === trackId);
  if (trackIdx === -1) return;
  const clipIdx = projectState.tracks[trackIdx].clips.findIndex(
    (c) => c.id === clipId,
  );
  if (clipIdx === -1) return;
  const fxArr = projectState.tracks[trackIdx].clips[clipIdx].effects;
  const effectIdx = fxArr.findIndex((e) => e.id === effectId);
  if (effectIdx === -1) return;

  // Read current keyframes as plain object (unwrap store proxy)
  const current = fxArr[effectIdx].keyframes ?? {};
  const plain: Record<string, Keyframe[]> = {};
  for (const key of Object.keys(current)) {
    plain[key] = (current[key] ?? []).map((k) => ({ ...k }));
  }

  const updated = updater(plain);

  // Use index-based path to set the keyframes property directly
  setProjectState(
    "tracks",
    trackIdx,
    "clips",
    clipIdx,
    "effects",
    effectIdx,
    "keyframes",
    updated,
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
): Keyframe {
  const kf: Keyframe = {
    id: `kf-${Date.now()}-${keyframeIdCounter++}`,
    time,
    value,
    easing,
  };

  mutateEffectKeyframes(trackId, clipId, effectId, (prev) => {
    const existing = prev[uniformName] || [];
    const filtered = existing.filter((k) => Math.abs(k.time - time) > 0.001);
    const updated = [...filtered, kf].sort((a, b) => a.time - b.time);
    return { ...prev, [uniformName]: updated };
  });

  return kf;
}

export function removeKeyframe(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
  keyframeId: string,
): void {
  mutateEffectKeyframes(trackId, clipId, effectId, (prev) => {
    const existing = prev[uniformName] || [];
    const filtered = existing.filter((k) => k.id !== keyframeId);
    if (filtered.length === 0) {
      const { [uniformName]: _, ...rest } = prev;
      return rest;
    }
    return { ...prev, [uniformName]: filtered };
  });
}

export function updateKeyframe(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
  keyframeId: string,
  updates: Partial<Pick<Keyframe, "time" | "value" | "easing">>,
): void {
  mutateEffectKeyframes(trackId, clipId, effectId, (prev) => {
    const existing = prev[uniformName] || [];
    const updated = existing
      .map((k) => (k.id === keyframeId ? { ...k, ...updates } : k))
      .sort((a, b) => a.time - b.time);
    return { ...prev, [uniformName]: updated };
  });
}

export function removeAllKeyframes(
  trackId: string,
  clipId: string,
  effectId: string,
  uniformName: string,
): void {
  mutateEffectKeyframes(trackId, clipId, effectId, (prev) => {
    const { [uniformName]: _, ...rest } = prev;
    return rest;
  });
}

/** Easing functions for keyframe interpolation */
function applyEasing(t: number, easing: KeyframeEasing): number {
  switch (easing) {
    case "linear":
      return t;
    case "ease-in":
      return t * t;
    case "ease-out":
      return t * (2 - t);
    case "ease-in-out":
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case "hold":
      return 0; // step function — hold previous value
    default:
      return t;
  }
}

/**
 * Interpolate keyframed value at a given time (relative to clip start).
 * Returns undefined if no keyframes exist for this uniform.
 */
export function interpolateKeyframes(
  keyframes: Keyframe[],
  time: number,
): number | undefined {
  if (!keyframes || keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0].value;

  // Before first keyframe
  if (time <= keyframes[0].time) return keyframes[0].value;
  // After last keyframe
  if (time >= keyframes[keyframes.length - 1].time)
    return keyframes[keyframes.length - 1].value;

  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (time >= a.time && time <= b.time) {
      if (b.easing === "hold") return a.value;
      const t = (time - a.time) / (b.time - a.time);
      const eased = applyEasing(t, b.easing);
      return a.value + (b.value - a.value) * eased;
    }
  }

  return keyframes[keyframes.length - 1].value;
}

/**
 * Get the effective value of a uniform at a given clip-relative time,
 * considering keyframes. Falls back to the static value.
 */
export function getEffectValueAtTime(
  effect: ClipEffect,
  uniformName: string,
  clipRelativeTime: number,
  fallback: number,
): number {
  const kfs = effect.keyframes?.[uniformName];
  if (!kfs || kfs.length === 0) return fallback;
  return interpolateKeyframes(kfs, clipRelativeTime) ?? fallback;
}

export function setClipTransition(
  trackId: string,
  clipId: string,
  transition: ClipTransition | undefined,
): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "transition",
    transition,
  );
}

export function removeClipTransition(trackId: string, clipId: string): void {
  setClipTransition(trackId, clipId, undefined);
}

export function addTextClip(
  trackId: string,
  startTime: number,
  duration: number = 5,
  text: string = "Title",
): Clip {
  const clip: Clip = {
    id: crypto.randomUUID(),
    mediaId: "__text__",
    trackId,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    effects: [],
    textOverlay: {
      text,
      fontFamily: "Inter, sans-serif",
      fontSize: 64,
      fontWeight: "bold",
      color: "#ffffff",
      x: 0.5,
      y: 0.5,
      align: "center",
    },
  };
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (clips) => [...clips, clip],
  );
  return clip;
}

export function updateTextOverlay(
  trackId: string,
  clipId: string,
  updates: Partial<TextOverlay>,
): void {
  setProjectState(
    "tracks",
    (t) => t.id === trackId,
    "clips",
    (c) => c.id === clipId,
    "textOverlay",
    (prev) => (prev ? { ...prev, ...updates } : undefined),
  );
}

export { projectState, setProjectState };
