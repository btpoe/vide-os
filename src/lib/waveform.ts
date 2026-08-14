/**
 * Waveform peaks as a mip pyramid.
 *
 * The previous implementation produced a fixed 200 peaks per file however long
 * it was, so a bar was eighteen seconds on an hour-long recording — the exact
 * defect Phase 2 set out to remove — and it got them by handing the whole file
 * to `decodeAudioData`, which held an hour of PCM in memory to draw a 200-pixel
 * strip.
 *
 * What replaces it is the standard answer: peaks at one fine resolution, then
 * halved repeatedly. A query picks the level whose buckets are just finer than
 * the pixel column being drawn, so the cost of drawing is proportional to the
 * number of columns on screen and not to the length of the file. An hour-long
 * recording and a two-second one cost the same to draw.
 *
 * This module is pure: no decoding, no platform, no DOM. Analysis lives in
 * `media/waveform-analysis.ts` and the cache in `lib/waveform-cache.ts`, which
 * is what lets the arithmetic here be tested in Node without WebCodecs.
 */

/**
 * Samples per bucket at the finest level.
 *
 * 128 samples is 2.7 ms at 48kHz. The timeline's maximum zoom is 600 px per
 * second (`MAX_PX_PER_SECOND`), where one pixel column is 1.7 ms — so at the
 * very top of the zoom range one bucket spans about 1.6 px, and everywhere
 * below it a column aggregates whole buckets. The cost of choosing it: an hour
 * at 48kHz is 1.35M buckets, and the whole pyramid — every level — is about
 * 5.4 MB, because a pyramid is at most twice its base.
 */
export const BASE_SAMPLES_PER_BUCKET = 128;

/** Peaks are stored as signed bytes; this is what ±1.0 maps to. */
const PEAK_SCALE = 127;

const MAGIC = 0x56574631; // "VWF1"
const FORMAT_VERSION = 1;
const HEADER_BYTES = 24;

/**
 * One level of the pyramid: min/max pairs, interleaved.
 *
 * Min and max rather than a single magnitude because the envelope of an
 * asymmetric signal is not symmetric, and mirroring one magnitude draws a
 * waveform that does not match the sound. Two bytes per bucket is also half
 * what a mirrored `Float32` peak cost.
 */
export interface PeakLevel {
  /** `[min0, max0, min1, max1, …]`, each in [-127, 127]. */
  readonly pairs: Int8Array;
  /** Source samples each bucket covers. */
  readonly samplesPerBucket: number;
}

export interface PeakPyramid {
  readonly sampleRate: number;
  /** Channels the source had. Peaks are the envelope across all of them. */
  readonly channels: number;
  /** Length in samples per channel, so a query can clamp to the real end. */
  readonly totalSamples: number;
  /** Finest level first. */
  readonly levels: readonly PeakLevel[];
}

/** Columns of envelope, ready to draw. Values in [-1, 1]. */
export interface PeakColumns {
  readonly min: Float32Array;
  readonly max: Float32Array;
}

// ── Building ──────────────────────────────────────────────────────────

/**
 * Builds the coarser levels by halving repeatedly.
 *
 * Each bucket is the envelope of the two below it, so a coarse level is exact
 * for the range it covers rather than a resampling of it: the peak of a peak is
 * the peak. That is what makes a zoomed-out waveform show real transients
 * instead of averaging them away.
 */
export function buildPyramid(
  base: Int8Array,
  options: { sampleRate: number; channels: number; totalSamples: number },
): PeakPyramid {
  const levels: PeakLevel[] = [
    { pairs: base, samplesPerBucket: BASE_SAMPLES_PER_BUCKET },
  ];

  let current = base;
  let samplesPerBucket = BASE_SAMPLES_PER_BUCKET;
  while (current.length > 2) {
    const buckets = current.length >> 1;
    const nextBuckets = Math.ceil(buckets / 2);
    const next = new Int8Array(nextBuckets * 2);

    for (let i = 0; i < nextBuckets; i++) {
      const a = i * 2;
      const b = a + 1;
      let lo = current[a * 2];
      let hi = current[a * 2 + 1];
      if (b < buckets) {
        lo = Math.min(lo, current[b * 2]);
        hi = Math.max(hi, current[b * 2 + 1]);
      }
      next[i * 2] = lo;
      next[i * 2 + 1] = hi;
    }

    samplesPerBucket *= 2;
    levels.push({ pairs: next, samplesPerBucket });
    current = next;
  }

  return {
    sampleRate: options.sampleRate,
    channels: options.channels,
    totalSamples: options.totalSamples,
    levels,
  };
}

/** Quantises a float sample to the stored byte range. */
export function quantisePeak(value: number): number {
  const scaled = Math.round(value * PEAK_SCALE);
  return scaled < -PEAK_SCALE ? -PEAK_SCALE : scaled > PEAK_SCALE ? PEAK_SCALE : scaled;
}

// ── Querying ──────────────────────────────────────────────────────────

/**
 * The level whose buckets are the largest that still fit inside one column.
 *
 * Aggregating whole buckets is what keeps a query O(columns): at the chosen
 * level a column covers between one and two buckets, so drawing a thousand
 * columns of an hour-long file touches a couple of thousand buckets rather than
 * the 1.35M in the base level.
 */
export function levelForColumns(
  pyramid: PeakPyramid,
  samplesPerColumn: number,
): number {
  let chosen = 0;
  for (let i = 1; i < pyramid.levels.length; i++) {
    if (pyramid.levels[i].samplesPerBucket > samplesPerColumn) break;
    chosen = i;
  }
  return chosen;
}

/**
 * Envelope over `[startSec, endSec)`, in `columns` equal steps.
 *
 * The range is the clip's *source* range, so trimming, slipping and retiming a
 * clip all move the waveform under it without anything being recomputed.
 * Columns that fall past the end of the media come back as silence rather than
 * repeating the last peak, so a clip overrunning its source looks like what it
 * is.
 */
export function peaksForRange(
  pyramid: PeakPyramid,
  startSec: number,
  endSec: number,
  columns: number,
): PeakColumns {
  const count = Math.max(1, Math.floor(columns));
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  if (endSec <= startSec) return { min, max };

  const { sampleRate, totalSamples } = pyramid;
  const startSample = startSec * sampleRate;
  const samplesPerColumn = ((endSec - startSec) * sampleRate) / count;
  const level = pyramid.levels[levelForColumns(pyramid, samplesPerColumn)];
  const bucketCount = level.pairs.length >> 1;
  const perBucket = level.samplesPerBucket;

  for (let c = 0; c < count; c++) {
    // Rounded to whole samples, because they are whole samples. Left as floats,
    // a column landing a millionth of a sample below a bucket boundary reads the
    // bucket before it as well, so a lone transient lights two columns.
    const from = Math.round(startSample + c * samplesPerColumn);
    const to = Math.round(startSample + (c + 1) * samplesPerColumn);
    if (to <= 0 || from >= totalSamples) continue;

    const first = Math.floor(Math.max(0, from) / perBucket);
    let last = Math.ceil(Math.min(totalSamples, to) / perBucket) - 1;
    // A column narrower than a bucket still has to read the bucket it sits in.
    if (last < first) last = first;
    if (first >= bucketCount) continue;
    if (last >= bucketCount) last = bucketCount - 1;

    let lo = 0;
    let hi = 0;
    for (let b = first; b <= last; b++) {
      const bucketLo = level.pairs[b * 2];
      const bucketHi = level.pairs[b * 2 + 1];
      if (bucketLo < lo) lo = bucketLo;
      if (bucketHi > hi) hi = bucketHi;
    }
    min[c] = lo / PEAK_SCALE;
    max[c] = hi / PEAK_SCALE;
  }

  return { min, max };
}

// ── Drawing ───────────────────────────────────────────────────────────

/**
 * An SVG path for the envelope: along the tops, back along the bottoms.
 *
 * `width` is normally the column count, with the caller stretching the result
 * through a `viewBox`, so one path serves whatever size the lane happens to be.
 */
export function peaksToSvgPath(
  peaks: PeakColumns,
  width: number,
  height: number,
): string {
  const count = peaks.max.length;
  if (count === 0 || width <= 0 || height <= 0) return "";

  const midY = height / 2;
  const scale = Math.max(0, midY - 0.5);
  const stepX = width / count;
  // Silence is a line rather than nothing: a zero-area polygon draws no pixels,
  // and "no waveform yet" and "no sound here" must not look the same.
  const minHalf = Math.min(0.5, scale);

  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = i * stepX;
    const y = midY - Math.max(peaks.max[i] * scale, minHalf);
    parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  for (let i = count - 1; i >= 0; i--) {
    const x = i * stepX;
    const y = midY - Math.min(peaks.min[i] * scale, -minHalf);
    parts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

// ── Serialisation ─────────────────────────────────────────────────────

/**
 * Packs a pyramid for the cache.
 *
 * Only the base level is written; the rest is halving, which is cheaper to redo
 * on load than to store. One buffer with a magic and a version rather than a
 * JSON sidecar, so a cache entry is either whole or absent.
 */
export function serialisePyramid(pyramid: PeakPyramid): Uint8Array<ArrayBuffer> {
  const base = pyramid.levels[0].pairs;
  const bytes = new Uint8Array(new ArrayBuffer(HEADER_BYTES + base.length));
  const view = new DataView(bytes.buffer);

  view.setUint32(0, MAGIC);
  view.setUint16(4, FORMAT_VERSION);
  view.setUint16(6, pyramid.channels);
  view.setUint32(8, pyramid.sampleRate);
  view.setUint32(12, BASE_SAMPLES_PER_BUCKET);
  // A double rather than a uint32: 2^32 samples is 24 hours at 48kHz, and a
  // length that wraps silently would draw the wrong part of the file.
  view.setFloat64(16, pyramid.totalSamples);
  bytes.set(new Uint8Array(base.buffer, base.byteOffset, base.length), HEADER_BYTES);

  return bytes;
}

/** Null for anything this version does not recognise — a stale entry is a miss. */
export function deserialisePyramid(bytes: Uint8Array): PeakPyramid | null {
  if (bytes.length < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== MAGIC) return null;
  if (view.getUint16(4) !== FORMAT_VERSION) return null;
  if (view.getUint32(12) !== BASE_SAMPLES_PER_BUCKET) return null;

  const channels = view.getUint16(6);
  const sampleRate = view.getUint32(8);
  const totalSamples = view.getFloat64(16);
  if (sampleRate <= 0) return null;

  const payload = bytes.subarray(HEADER_BYTES);
  // Copied, not viewed: the buffer behind a cache read is not ours to keep, and
  // an odd length would make a bucket without a max.
  const base = new Int8Array((payload.length >> 1) * 2);
  base.set(new Int8Array(payload.buffer, payload.byteOffset, base.length));

  return buildPyramid(base, { sampleRate, channels, totalSamples });
}
