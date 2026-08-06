/**
 * Animatable parameters and keyframe evaluation.
 *
 * One evaluator serves every animatable thing — effect uniforms, opacity,
 * transform, crop, volume, pan — so they share the same interpolation, the
 * same keyframe UI, and the same tests. Keyframe times are integer frames
 * relative to the clip's start, not seconds, so a keyframe lands on a frame
 * boundary and stays there when the clip is moved or the project is reopened.
 *
 * Pure: no stores, no DOM, no reactivity.
 */

export type Interp = "hold" | "linear" | "bezier";

/** A single control point. `out`/`in` are bezier handles in normalised space. */
export interface Keyframe<T = number> {
  id: string;
  /** Frames from the start of the clip. */
  timeFrames: number;
  value: T;
  interp: Interp;
  /** Outgoing handle of this key, as [x, y] with x in 0..1. */
  out?: [number, number];
  /** Incoming handle of the *next* key, as [x, y] with x in 0..1. */
  in?: [number, number];
}

/**
 * A value that may vary over the clip. With no keys it is a constant; with
 * keys, `value` is ignored and acts as the fallback for an empty key list.
 */
export interface Animatable<T = number> {
  value: T;
  keys?: Keyframe<T>[];
}

export type AnimatableValue = number | number[];

export function constant<T>(value: T): Animatable<T> {
  return { value };
}

export function isAnimated<T>(param: Animatable<T>): boolean {
  return !!param.keys && param.keys.length > 0;
}

// ── Easing ────────────────────────────────────────────────────────────

/**
 * Named presets kept so the old `KeyframeEasing` enum can be migrated onto
 * bezier handles without losing intent.
 */
export const EASING_PRESETS = {
  linear: {
    out: [0.25, 0.25] as [number, number],
    in: [0.75, 0.75] as [number, number],
  },
  "ease-in": { out: [0.42, 0] as [number, number], in: [1, 1] as [number, number] },
  "ease-out": { out: [0, 0] as [number, number], in: [0.58, 1] as [number, number] },
  "ease-in-out": {
    out: [0.42, 0] as [number, number],
    in: [0.58, 1] as [number, number],
  },
} as const;

export type EasingPreset = keyof typeof EASING_PRESETS;

function cubicBezierComponent(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  // Endpoints are fixed at 0 and 1, so only the two control points vary.
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

/**
 * Solves a CSS-style cubic bezier for y given x, by Newton's method with a
 * bisection fallback. x is the normalised position between two keyframes.
 */
export function cubicBezier(
  x: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  let t = x;
  for (let i = 0; i < 8; i++) {
    const currentX = cubicBezierComponent(t, p1x, p2x) - x;
    if (Math.abs(currentX) < 1e-6) return cubicBezierComponent(t, p1y, p2y);
    const mt = 1 - t;
    const derivative =
      3 * mt * mt * p1x + 6 * mt * t * (p2x - p1x) + 3 * t * t * (1 - p2x);
    if (Math.abs(derivative) < 1e-6) break;
    t -= currentX / derivative;
  }

  // Newton can diverge for extreme handles; bisect to a stable answer.
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 20; i++) {
    const currentX = cubicBezierComponent(t, p1x, p2x);
    if (Math.abs(currentX - x) < 1e-6) break;
    if (currentX < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return cubicBezierComponent(t, p1y, p2y);
}

// ── Interpolation ─────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolates componentwise, so vec2/vec3/colour uniforms work with the same
 * keyframe machinery as scalars. Mismatched lengths fall back to the earlier
 * value rather than producing a ragged array.
 */
function interpolateValue<T>(a: T, b: T, t: number): T {
  if (typeof a === "number" && typeof b === "number") {
    return lerp(a, b, t) as T;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return a;
    return a.map((v: number, i) => lerp(v, (b as number[])[i], t)) as T;
  }
  // Non-numeric values (strings, enums) can only step.
  return t < 1 ? a : b;
}

/**
 * Index of the last keyframe at or before `timeFrames`, or -1 if the time
 * precedes every key. Binary search — parameter evaluation runs per layer per
 * frame, and a linear scan over a densely keyed parameter shows up in profiles.
 *
 * `keys` must be sorted by `timeFrames`; `sortKeys` guarantees that.
 */
export function findKeyIndex<T>(
  keys: readonly Keyframe<T>[],
  timeFrames: number,
): number {
  let lo = 0;
  let hi = keys.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].timeFrames <= timeFrames) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Value of a parameter at a time, in frames relative to the clip's start.
 *
 * Before the first key it holds that key's value; after the last it holds that
 * one. Between keys it interpolates by the *earlier* key's `interp` — the
 * segment's shape belongs to the key it leaves, which is what a keyframe editor
 * shows when you drag an outgoing handle.
 */
export function evaluate<T>(param: Animatable<T>, timeFrames: number): T {
  const keys = param.keys;
  if (!keys || keys.length === 0) return param.value;
  if (keys.length === 1) return keys[0].value;

  const i = findKeyIndex(keys, timeFrames);
  if (i < 0) return keys[0].value;
  if (i >= keys.length - 1) return keys[keys.length - 1].value;

  const a = keys[i];
  const b = keys[i + 1];
  if (a.interp === "hold") return a.value;

  const span = b.timeFrames - a.timeFrames;
  // Coincident keys would divide by zero; the later value wins.
  if (span <= 0) return b.value;

  const t = (timeFrames - a.timeFrames) / span;
  if (a.interp === "linear") return interpolateValue(a.value, b.value, t);

  const [p1x, p1y] = a.out ?? EASING_PRESETS["ease-in-out"].out;
  const [p2x, p2y] = b.in ?? EASING_PRESETS["ease-in-out"].in;
  return interpolateValue(a.value, b.value, cubicBezier(t, p1x, p1y, p2x, p2y));
}

// ── Mutation helpers ──────────────────────────────────────────────────

/** Sorts in place and returns the same array. Callers own the copy. */
export function sortKeys<T>(keys: Keyframe<T>[]): Keyframe<T>[] {
  return keys.sort((a, b) => a.timeFrames - b.timeFrames);
}

/**
 * Adds a key, replacing any existing key at the same frame. Two keys on one
 * frame have no meaningful ordering and make the segment span zero.
 */
export function setKey<T>(param: Animatable<T>, key: Keyframe<T>): Animatable<T> {
  const keys = (param.keys ?? []).filter((k) => k.timeFrames !== key.timeFrames);
  keys.push(key);
  return { ...param, keys: sortKeys(keys) };
}

export function removeKey<T>(param: Animatable<T>, keyId: string): Animatable<T> {
  const keys = (param.keys ?? []).filter((k) => k.id !== keyId);
  // Dropping the last key returns the parameter to a constant, holding the
  // value it had rather than snapping back to the original.
  if (keys.length === 0) {
    const previous = param.keys?.[0];
    return { value: previous ? previous.value : param.value };
  }
  return { ...param, keys };
}

export function clearKeys<T>(param: Animatable<T>, atFrames = 0): Animatable<T> {
  return { value: evaluate(param, atFrames) };
}

/** Nearest key strictly before `timeFrames`, for prev-keyframe navigation. */
export function previousKey<T>(
  param: Animatable<T>,
  timeFrames: number,
): Keyframe<T> | undefined {
  const keys = param.keys;
  if (!keys?.length) return undefined;
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i].timeFrames < timeFrames) return keys[i];
  }
  return undefined;
}

/** Nearest key strictly after `timeFrames`. */
export function nextKey<T>(
  param: Animatable<T>,
  timeFrames: number,
): Keyframe<T> | undefined {
  return param.keys?.find((k) => k.timeFrames > timeFrames);
}

export function keyAt<T>(
  param: Animatable<T>,
  timeFrames: number,
): Keyframe<T> | undefined {
  return param.keys?.find((k) => k.timeFrames === timeFrames);
}
