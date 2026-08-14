import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  BASE_SAMPLES_PER_BUCKET,
  buildPyramid,
  deserialisePyramid,
  levelForColumns,
  peaksForRange,
  peaksToSvgPath,
  quantisePeak,
  serialisePyramid,
  type PeakPyramid,
} from "@/lib/waveform";

/**
 * The peak pyramid's arithmetic.
 *
 * The point of the rewrite is that drawing a waveform costs the same on an
 * hour-long file as on a two-second one, and that zooming in shows more detail
 * rather than a stretched copy of the same 200 bars. Both of those are claims
 * about this module, so they are asserted here rather than inferred from a
 * screenshot.
 */

const RATE = 48000;

function pyramidFrom(
  pairs: number[],
  options: { sampleRate?: number; totalSamples?: number } = {},
): PeakPyramid {
  const base = Int8Array.from(pairs);
  const buckets = base.length >> 1;
  return buildPyramid(base, {
    sampleRate: options.sampleRate ?? RATE,
    channels: 1,
    totalSamples: options.totalSamples ?? buckets * BASE_SAMPLES_PER_BUCKET,
  });
}

/** A base level with a distinct min/max in every bucket. */
function ramp(buckets: number): number[] {
  const pairs: number[] = [];
  for (let i = 0; i < buckets; i++) {
    pairs.push(-1 - (i % 100), 1 + ((i * 7) % 120));
  }
  return pairs;
}

function envelopeOfLevel(pyramid: PeakPyramid, level: number) {
  const pairs = pyramid.levels[level].pairs;
  const buckets = pairs.length >> 1;
  const min: number[] = [];
  const max: number[] = [];
  for (let i = 0; i < buckets; i++) {
    min.push(pairs[i * 2] / 127);
    max.push(pairs[i * 2 + 1] / 127);
  }
  return { min, max };
}

describe("pyramid construction", () => {
  it("halves until one bucket is left", () => {
    const pyramid = pyramidFrom(ramp(64));
    expect(pyramid.levels.map((l) => l.pairs.length >> 1)).toEqual([
      64, 32, 16, 8, 4, 2, 1,
    ]);
    expect(pyramid.levels.map((l) => l.samplesPerBucket)).toEqual([
      128, 256, 512, 1024, 2048, 4096, 8192,
    ]);
  });

  it("costs at most twice its base level", () => {
    const pyramid = pyramidFrom(ramp(1000));
    const total = pyramid.levels.reduce((sum, l) => sum + l.pairs.length, 0);
    // Twice the base, plus at most one rounded-up bucket per level.
    expect(total).toBeLessThanOrEqual(
      pyramid.levels[0].pairs.length * 2 + pyramid.levels.length * 2,
    );
  });

  it("keeps an odd bucket rather than dropping it", () => {
    // A file whose bucket count is odd at some level must not lose its tail —
    // that would silently truncate the end of the waveform.
    const pyramid = pyramidFrom([0, 10, 0, 20, 0, 90]);
    expect(pyramid.levels[1].pairs.length >> 1).toBe(2);
    expect(pyramid.levels[1].pairs[3]).toBe(90);
  });

  it("makes every coarse bucket the envelope of the fine ones under it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -127, max: 127 }), { minLength: 8, maxLength: 400 }),
        (values) => {
          // Two values per bucket, forced into min/max order.
          const pairs: number[] = [];
          for (let i = 0; i + 1 < values.length; i += 2) {
            pairs.push(Math.min(values[i], values[i + 1], 0));
            pairs.push(Math.max(values[i], values[i + 1], 0));
          }
          const pyramid = pyramidFrom(pairs);

          for (let level = 1; level < pyramid.levels.length; level++) {
            const coarse = pyramid.levels[level].pairs;
            const fine = pyramid.levels[level - 1].pairs;
            const fineBuckets = fine.length >> 1;

            for (let i = 0; i < coarse.length >> 1; i++) {
              let lo = fine[i * 4];
              let hi = fine[i * 4 + 1];
              if (i * 2 + 1 < fineBuckets) {
                lo = Math.min(lo, fine[i * 4 + 2]);
                hi = Math.max(hi, fine[i * 4 + 3]);
              }
              expect(coarse[i * 2]).toBe(lo);
              expect(coarse[i * 2 + 1]).toBe(hi);
            }
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe("querying", () => {
  it("picks the finest level whose buckets fit inside a column", () => {
    const pyramid = pyramidFrom(ramp(64));
    expect(levelForColumns(pyramid, BASE_SAMPLES_PER_BUCKET)).toBe(0);
    expect(levelForColumns(pyramid, BASE_SAMPLES_PER_BUCKET - 1)).toBe(0);
    expect(levelForColumns(pyramid, BASE_SAMPLES_PER_BUCKET * 4)).toBe(2);
    // Never past the top, however far out you zoom.
    expect(levelForColumns(pyramid, 1e12)).toBe(pyramid.levels.length - 1);
  });

  it("reads a bounded number of buckets however long the file is", () => {
    // An hour at 48kHz. The claim under test is that the query cost is set by
    // the column count and not by the file length, so both of these read the
    // same handful of buckets per column.
    const buckets = Math.ceil((3600 * RATE) / BASE_SAMPLES_PER_BUCKET);
    const hour = buildPyramid(new Int8Array(buckets * 2), {
      sampleRate: RATE,
      channels: 2,
      totalSamples: 3600 * RATE,
    });

    const columns = 1000;
    const samplesPerColumn = (3600 * RATE) / columns;
    const level = hour.levels[levelForColumns(hour, samplesPerColumn)];
    // Each column spans between one and two buckets at the chosen level.
    expect(samplesPerColumn / level.samplesPerBucket).toBeGreaterThanOrEqual(1);
    expect(samplesPerColumn / level.samplesPerBucket).toBeLessThan(2);
  });

  it("is exact when columns line up with a level", () => {
    const pyramid = pyramidFrom(ramp(64));
    const durationSec = pyramid.totalSamples / RATE;

    for (const level of [0, 1, 2, 3]) {
      const columns = 64 >> level;
      const peaks = peaksForRange(pyramid, 0, durationSec, columns);
      const expected = envelopeOfLevel(pyramid, level);
      // Float32 out, doubles in the expectation, so compared rather than equal.
      expect([...peaks.max]).toEqual(expected.max.map(Math.fround));
      expect([...peaks.min]).toEqual(expected.min.map(Math.fround));
    }
  });

  it("shows more detail as the range narrows", () => {
    // One loud bucket in an otherwise quiet file. Zoomed out it shares a column
    // with its quiet neighbours; zoomed in it gets a column of its own, and the
    // columns either side are quiet. The old fixed-200-peak waveform could not
    // do this: every zoom level got the same 200 numbers.
    const pairs = ramp(256).map((v) => (Math.abs(v) > 0 ? Math.sign(v) * 2 : v));
    pairs[100 * 2] = -120;
    pairs[100 * 2 + 1] = 120;
    const pyramid = pyramidFrom(pairs);

    const wide = peaksForRange(pyramid, 0, pyramid.totalSamples / RATE, 8);
    const loudColumns = [...wide.max].filter((v) => v > 0.9).length;
    expect(loudColumns).toBe(1);

    const bucketSec = BASE_SAMPLES_PER_BUCKET / RATE;
    const near = peaksForRange(pyramid, 98 * bucketSec, 103 * bucketSec, 5);
    expect([...near.max].filter((v) => v > 0.9).length).toBe(1);
    expect(near.max[2]).toBeGreaterThan(0.9);
    expect(near.max[0]).toBeLessThan(0.1);
    expect(near.max[4]).toBeLessThan(0.1);
  });

  it("reads silence past the end of the media rather than holding the last peak", () => {
    const pyramid = pyramidFrom(ramp(64));
    const durationSec = pyramid.totalSamples / RATE;

    // A clip trimmed to twice the length of its source: the second half has no
    // material, and showing the last peak repeated would hide that.
    const peaks = peaksForRange(pyramid, 0, durationSec * 2, 64);
    expect([...peaks.max].slice(32).every((v) => v === 0)).toBe(true);
    expect([...peaks.max].slice(0, 32).some((v) => v > 0)).toBe(true);
  });

  it("returns silence for an empty or inverted range", () => {
    const pyramid = pyramidFrom(ramp(16));
    expect([...peaksForRange(pyramid, 1, 1, 4).max]).toEqual([0, 0, 0, 0]);
    expect([...peaksForRange(pyramid, 2, 1, 4).max]).toEqual([0, 0, 0, 0]);
  });

  it("never reports a peak the file does not contain", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 127 }), { minLength: 4, maxLength: 200 }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        fc.double({ min: 0.01, max: 8, noNaN: true }),
        fc.integer({ min: 1, max: 300 }),
        (amplitudes, startSec, spanSec, columns) => {
          const pairs = amplitudes.flatMap((a) => [-a, a]);
          const pyramid = pyramidFrom(pairs);
          const bound = Math.fround(Math.max(...amplitudes) / 127);

          const peaks = peaksForRange(pyramid, startSec, startSec + spanSec, columns);
          for (let i = 0; i < columns; i++) {
            expect(peaks.max[i]).toBeLessThanOrEqual(bound);
            expect(peaks.min[i]).toBeGreaterThanOrEqual(-bound);
            // Zero is always inside the envelope, which is what lets the path be
            // drawn as one polygon around the midline.
            expect(peaks.max[i]).toBeGreaterThanOrEqual(0);
            expect(peaks.min[i]).toBeLessThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("does not confuse a quiet file with a file that has no peaks yet", () => {
    const silence = pyramidFrom(new Array(32).fill(0));
    const path = peaksToSvgPath(peaksForRange(silence, 0, 1, 16), 16, 40);
    // A zero-area polygon draws nothing at all, which would look identical to a
    // waveform that has not been generated. Silence gets a line.
    expect(path).not.toBe("");
    expect(path).toContain("19.50");
    expect(path).toContain("20.50");
  });
});

describe("serialisation", () => {
  it("round-trips through the cache format", () => {
    const pyramid = pyramidFrom(ramp(100), { totalSamples: 100 * 128 - 7 });
    const restored = deserialisePyramid(serialisePyramid(pyramid));

    expect(restored).not.toBeNull();
    expect(restored!.sampleRate).toBe(pyramid.sampleRate);
    expect(restored!.channels).toBe(pyramid.channels);
    expect(restored!.totalSamples).toBe(pyramid.totalSamples);
    expect([...restored!.levels[0].pairs]).toEqual([...pyramid.levels[0].pairs]);
    expect(restored!.levels.length).toBe(pyramid.levels.length);
  });

  it("stores only the base level", () => {
    const pyramid = pyramidFrom(ramp(1024));
    const bytes = serialisePyramid(pyramid);
    expect(bytes.length).toBe(24 + 1024 * 2);
  });

  it("keeps a sample count too large for a uint32", () => {
    // 2^32 samples is 24 hours at 48kHz. A length that wrapped would draw the
    // wrong part of the file rather than failing.
    const pyramid = pyramidFrom(ramp(8), { totalSamples: 5_000_000_000 });
    expect(deserialisePyramid(serialisePyramid(pyramid))!.totalSamples).toBe(
      5_000_000_000,
    );
  });

  it("treats anything it does not recognise as a miss", () => {
    expect(deserialisePyramid(new Uint8Array(4))).toBeNull();
    expect(deserialisePyramid(new Uint8Array(64))).toBeNull();

    const good = serialisePyramid(pyramidFrom(ramp(8)));
    const wrongVersion = good.slice();
    new DataView(wrongVersion.buffer).setUint16(4, 99);
    expect(deserialisePyramid(wrongVersion)).toBeNull();

    const wrongBucketSize = good.slice();
    new DataView(wrongBucketSize.buffer).setUint32(12, 64);
    expect(deserialisePyramid(wrongBucketSize)).toBeNull();
  });

  it("survives a payload with an odd byte count", () => {
    const good = serialisePyramid(pyramidFrom(ramp(8)));
    const truncated = good.slice(0, good.length - 1);
    const restored = deserialisePyramid(truncated);
    expect(restored).not.toBeNull();
    expect(restored!.levels[0].pairs.length % 2).toBe(0);
  });
});

describe("quantisation", () => {
  it("clamps rather than wrapping", () => {
    expect(quantisePeak(0)).toBe(0);
    expect(quantisePeak(1)).toBe(127);
    expect(quantisePeak(-1)).toBe(-127);
    // Inter-sample peaks in a decoded float stream do exceed ±1, and wrapping
    // one would draw a loud transient as its opposite.
    expect(quantisePeak(1.9)).toBe(127);
    expect(quantisePeak(-4)).toBe(-127);
  });
});
