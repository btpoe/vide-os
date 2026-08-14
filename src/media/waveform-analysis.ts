/**
 * Streaming waveform analysis.
 *
 * Decodes an audio track once, start to finish, accumulating min/max peaks into
 * the base level of a mip pyramid. Nothing here touches the DOM or Web Audio,
 * so it runs identically on the main thread and inside a worker — which is the
 * whole point, since analysing an hour of audio is the longest single block of
 * main-thread work the app has.
 *
 * Two things it deliberately does not do:
 *
 * - **It does not call `decodeAudioData`.** That holds the entire decoded file in
 *   memory — an hour of 48kHz stereo is 1.4 GB of float — to produce a few
 *   megabytes of peaks. `AudioSampleSink` hands back one block at a time, so memory is
 *   bounded by the peaks and not by the media.
 * - **It does not use `OfflineAudioContext`.** Web Audio does not exist in a
 *   worker. Peaks are computed from raw interleaved floats instead, which is
 *   also exactly what the pyramid wants.
 */

import { AudioSampleSink, type Input } from "mediabunny";
import type { Bytes } from "@/platform/types";
import { createBlobSource } from "./source";
import { openInput } from "./probe";
import {
  BASE_SAMPLES_PER_BUCKET,
  buildPyramid,
  quantisePeak,
  serialisePyramid,
} from "@/lib/waveform";

/**
 * Longest file analysed.
 *
 * Not a memory limit on the audio — that streams — but on the peaks: six hours
 * at 48kHz is an 8.1M-bucket base level, about 16 MB. Beyond this the pyramid
 * itself wants a coarser base, which is a change to the format rather than a
 * bigger number here.
 */
const MAX_ANALYSIS_SEC = 6 * 60 * 60;

/**
 * Scans a decodable audio track and returns its peaks.
 *
 * Null rather than throwing for the ordinary cases — no audio track, a codec
 * this browser will not decode, a file longer than the cap — because a clip
 * without a waveform is a cosmetic loss and the caller has nothing better to do
 * with an exception.
 */
async function analyseWaveform(input: Input): Promise<Bytes | null> {
  const track = await input.getPrimaryAudioTrack().catch(() => null);
  if (!track) return null;
  if (!(await track.canDecode().catch(() => false))) return null;

  const sampleRate = await track.getSampleRate();
  const channels = await track.getNumberOfChannels();
  if (!sampleRate) return null;

  const durationSec = await track.computeDuration().catch(() => 0);
  if (durationSec <= 0 || durationSec > MAX_ANALYSIS_SEC) return null;

  const totalSamples = Math.ceil(durationSec * sampleRate);
  const buckets = Math.max(1, Math.ceil(totalSamples / BASE_SAMPLES_PER_BUCKET));
  const base = new Int8Array(buckets * 2);
  const lastBucket = buckets - 1;

  const sink = new AudioSampleSink(track);
  let scratch = new Float32Array(0);

  for await (const sample of sink.samples()) {
    try {
      const frames = sample.numberOfFrames;
      const sampleChannels = sample.numberOfChannels;
      const needed = frames * sampleChannels;
      if (scratch.length < needed) scratch = new Float32Array(needed);

      // Interleaved rather than per-channel planes: one copy per block, and the
      // envelope wants every channel anyway.
      sample.copyTo(scratch.subarray(0, needed), { planeIndex: 0, format: "f32" });

      const firstSample = Math.max(0, Math.round(sample.timestamp * sampleRate));

      for (let i = 0; i < frames; i++) {
        // A file whose decoded audio runs past its stated duration writes into
        // the final bucket rather than off the end. AAC does exactly that: it
        // carries encoder priming and pads to a frame boundary, so a two-second
        // fixture decodes as ~2.07 seconds (see findings 3.7).
        let bucket = (firstSample + i) / BASE_SAMPLES_PER_BUCKET;
        bucket = bucket < 0 ? 0 : bucket > lastBucket ? lastBucket : Math.floor(bucket);

        const lowIndex = bucket * 2;
        let lo = base[lowIndex];
        let hi = base[lowIndex + 1];
        const offset = i * sampleChannels;
        for (let c = 0; c < sampleChannels; c++) {
          const value = quantisePeak(scratch[offset + c]);
          if (value < lo) lo = value;
          if (value > hi) hi = value;
        }
        base[lowIndex] = lo;
        base[lowIndex + 1] = hi;
      }
    } finally {
      sample.close();
    }
  }

  return serialisePyramid(buildPyramid(base, { sampleRate, channels, totalSamples }));
}

/**
 * Peaks for a blob, opening and disposing its own demuxer.
 *
 * Returns a serialised `PeakPyramid` — bytes rather than a parsed pyramid,
 * because the caller is either a worker about to transfer them or a cache about
 * to store them, and both want the buffer.
 */
export async function analyseWaveformBlob(blob: Blob): Promise<Bytes | null> {
  // Its own `Input` rather than the shared registry's: this is a one-shot
  // background scan of the whole file, and it may be running in a worker where
  // the registry does not exist at all.
  const input = openInput(createBlobSource(blob));
  try {
    return await analyseWaveform(input);
  } finally {
    input.dispose();
  }
}
