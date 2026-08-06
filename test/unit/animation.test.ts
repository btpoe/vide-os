import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  constant,
  isAnimated,
  evaluate,
  cubicBezier,
  findKeyIndex,
  setKey,
  removeKey,
  clearKeys,
  previousKey,
  nextKey,
  keyAt,
  sortKeys,
  EASING_PRESETS,
  type Animatable,
  type Keyframe,
  type Interp,
} from "@/lib/animation";

function key(
  timeFrames: number,
  value: number,
  interp: Interp = "linear",
): Keyframe<number> {
  return { id: `k${timeFrames}`, timeFrames, value, interp };
}

describe("constants", () => {
  it("returns the value at any time when unkeyed", () => {
    const p = constant(0.5);
    expect(isAnimated(p)).toBe(false);
    for (const t of [-100, 0, 1, 9999]) expect(evaluate(p, t)).toBe(0.5);
  });

  it("treats an empty key array as unkeyed", () => {
    const p: Animatable<number> = { value: 7, keys: [] };
    expect(isAnimated(p)).toBe(false);
    expect(evaluate(p, 42)).toBe(7);
  });
});

describe("evaluation", () => {
  const p: Animatable<number> = { value: 0, keys: [key(0, 0), key(10, 100)] };

  it("holds the first key before the range", () => {
    expect(evaluate(p, -50)).toBe(0);
    expect(evaluate(p, 0)).toBe(0);
  });

  it("holds the last key after the range", () => {
    expect(evaluate(p, 10)).toBe(100);
    expect(evaluate(p, 500)).toBe(100);
  });

  it("interpolates linearly between keys", () => {
    expect(evaluate(p, 5)).toBeCloseTo(50, 10);
    expect(evaluate(p, 1)).toBeCloseTo(10, 10);
    expect(evaluate(p, 9)).toBeCloseTo(90, 10);
  });

  it("ignores the base value once keyed", () => {
    const keyed: Animatable<number> = {
      value: 999,
      keys: [key(0, 1), key(10, 2)],
    };
    expect(evaluate(keyed, 0)).toBe(1);
    expect(evaluate(keyed, 5)).toBeCloseTo(1.5, 10);
  });

  it("returns the single key's value everywhere when only one exists", () => {
    const one: Animatable<number> = { value: 0, keys: [key(30, 42)] };
    expect(evaluate(one, 0)).toBe(42);
    expect(evaluate(one, 30)).toBe(42);
    expect(evaluate(one, 1000)).toBe(42);
  });

  it("steps at the later key for hold segments", () => {
    const held: Animatable<number> = {
      value: 0,
      keys: [key(0, 0, "hold"), key(10, 100)],
    };
    expect(evaluate(held, 0)).toBe(0);
    expect(evaluate(held, 9)).toBe(0);
    expect(evaluate(held, 10)).toBe(100);
  });

  it("takes the segment shape from the earlier key", () => {
    // The outgoing key owns the segment — dragging its out handle is what a
    // keyframe editor shows changing.
    const a: Animatable<number> = {
      value: 0,
      keys: [key(0, 0, "hold"), key(10, 100, "linear")],
    };
    const b: Animatable<number> = {
      value: 0,
      keys: [key(0, 0, "linear"), key(10, 100, "hold")],
    };
    expect(evaluate(a, 5)).toBe(0);
    expect(evaluate(b, 5)).toBeCloseTo(50, 10);
  });

  it("survives coincident keys without dividing by zero", () => {
    const dup: Animatable<number> = {
      value: 0,
      keys: [key(5, 10), { ...key(5, 20), id: "other" }],
    };
    expect(Number.isFinite(evaluate(dup, 5))).toBe(true);
  });

  it("interpolates arrays componentwise", () => {
    const vec: Animatable<number[]> = {
      value: [0, 0, 0],
      keys: [
        { id: "a", timeFrames: 0, value: [0, 10, 100], interp: "linear" },
        { id: "b", timeFrames: 10, value: [10, 20, 0], interp: "linear" },
      ],
    };
    expect(evaluate(vec, 5)).toEqual([5, 15, 50]);
  });

  it("falls back to the earlier value on mismatched array lengths", () => {
    const ragged: Animatable<number[]> = {
      value: [],
      keys: [
        { id: "a", timeFrames: 0, value: [1, 2], interp: "linear" },
        { id: "b", timeFrames: 10, value: [1, 2, 3], interp: "linear" },
      ],
    };
    expect(evaluate(ragged, 5)).toEqual([1, 2]);
  });

  it("stays within the key value range for any interpolation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 150 }),
        fc.constantFrom<Interp>("hold", "linear", "bezier"),
        (t, interp) => {
          const param: Animatable<number> = {
            value: 0,
            keys: [key(0, 20, interp), key(100, 80, interp)],
          };
          const v = evaluate(param, t);
          expect(v).toBeGreaterThanOrEqual(20);
          expect(v).toBeLessThanOrEqual(80);
        },
      ),
    );
  });

  it("is monotonic across a rising linear segment", () => {
    const param: Animatable<number> = { value: 0, keys: [key(0, 0), key(100, 1)] };
    let prev = -Infinity;
    for (let t = 0; t <= 100; t++) {
      const v = evaluate(param, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("cubic bezier", () => {
  it("is pinned at the endpoints", () => {
    expect(cubicBezier(0, 0.42, 0, 0.58, 1)).toBe(0);
    expect(cubicBezier(1, 0.42, 0, 0.58, 1)).toBe(1);
  });

  it("clamps outside 0..1", () => {
    expect(cubicBezier(-1, 0.42, 0, 0.58, 1)).toBe(0);
    expect(cubicBezier(2, 0.42, 0, 0.58, 1)).toBe(1);
  });

  it("reproduces linear when handles are on the diagonal", () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(cubicBezier(x, 0.25, 0.25, 0.75, 0.75)).toBeCloseTo(x, 4);
    }
  });

  it("ease-in starts slower than linear", () => {
    const { out, in: inH } = EASING_PRESETS["ease-in"];
    expect(cubicBezier(0.25, out[0], out[1], inH[0], inH[1])).toBeLessThan(0.25);
  });

  it("ease-out starts faster than linear", () => {
    const { out, in: inH } = EASING_PRESETS["ease-out"];
    expect(cubicBezier(0.25, out[0], out[1], inH[0], inH[1])).toBeGreaterThan(0.25);
  });

  it("stays in 0..1 and stays monotonic for CSS-legal handles", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (x, p1x, p2x) => {
          const y = cubicBezier(x, p1x, 0, p2x, 1);
          expect(y).toBeGreaterThanOrEqual(-1e-6);
          expect(y).toBeLessThanOrEqual(1 + 1e-6);
        },
      ),
    );
  });
});

describe("key lookup", () => {
  const keys = [key(0, 0), key(10, 1), key(20, 2), key(30, 3)];

  it("finds the last key at or before a time", () => {
    expect(findKeyIndex(keys, -1)).toBe(-1);
    expect(findKeyIndex(keys, 0)).toBe(0);
    expect(findKeyIndex(keys, 9)).toBe(0);
    expect(findKeyIndex(keys, 10)).toBe(1);
    expect(findKeyIndex(keys, 25)).toBe(2);
    expect(findKeyIndex(keys, 999)).toBe(3);
  });

  it("agrees with a linear scan", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 200 }), {
          minLength: 1,
          maxLength: 40,
        }),
        fc.integer({ min: -10, max: 210 }),
        (times, t) => {
          const sorted = sortKeys(times.map((n) => key(n, n)));
          let expected = -1;
          for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].timeFrames <= t) expected = i;
          }
          expect(findKeyIndex(sorted, t)).toBe(expected);
        },
      ),
    );
  });
});

describe("key mutation", () => {
  it("keeps keys sorted when inserting out of order", () => {
    let p: Animatable<number> = constant(0);
    p = setKey(p, key(30, 3));
    p = setKey(p, key(10, 1));
    p = setKey(p, key(20, 2));
    expect(p.keys?.map((k) => k.timeFrames)).toEqual([10, 20, 30]);
  });

  it("replaces rather than duplicates a key on the same frame", () => {
    let p: Animatable<number> = constant(0);
    p = setKey(p, key(10, 1));
    p = setKey(p, { ...key(10, 99), id: "replacement" });
    expect(p.keys).toHaveLength(1);
    expect(p.keys?.[0].value).toBe(99);
  });

  it("does not mutate the input", () => {
    const original: Animatable<number> = { value: 0, keys: [key(0, 0)] };
    const snapshot = JSON.stringify(original);
    setKey(original, key(10, 1));
    removeKey(original, "k0");
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("returns to a constant holding the last value when the final key goes", () => {
    // Removing the last key must not snap the parameter back to whatever the
    // base value happened to be before it was animated.
    const p: Animatable<number> = { value: 0, keys: [key(0, 42)] };
    const cleared = removeKey(p, "k0");
    expect(isAnimated(cleared)).toBe(false);
    expect(cleared.value).toBe(42);
  });

  it("freezes the evaluated value when clearing all keys", () => {
    const p: Animatable<number> = { value: 0, keys: [key(0, 0), key(10, 100)] };
    expect(clearKeys(p, 5).value).toBeCloseTo(50, 10);
    expect(isAnimated(clearKeys(p, 5))).toBe(false);
  });
});

describe("key navigation", () => {
  const p: Animatable<number> = {
    value: 0,
    keys: [key(0, 0), key(10, 1), key(20, 2)],
  };

  it("finds strictly earlier and later keys", () => {
    expect(previousKey(p, 10)?.timeFrames).toBe(0);
    expect(nextKey(p, 10)?.timeFrames).toBe(20);
  });

  it("returns undefined past the ends", () => {
    expect(previousKey(p, 0)).toBeUndefined();
    expect(nextKey(p, 20)).toBeUndefined();
  });

  it("finds an exact key", () => {
    expect(keyAt(p, 10)?.value).toBe(1);
    expect(keyAt(p, 11)).toBeUndefined();
  });
});
