/**
 * Decoded audio, cached per asset.
 *
 * The whole track is decoded into one `AudioBuffer` and kept. That is a real
 * memory cost — a minute of 48kHz stereo float is about 23 MB — so it is
 * bounded, and long files are refused rather than silently eating the heap.
 * Streaming decode for long-form material is a later problem; for the material
 * this editor targets, having the whole thing resident makes scheduling trivial
 * and exact.
 *
 * Crucially this works for **audio-only files** as well as video. The previous
 * implementation only ever played audio through a `<video>` element, so an MP3
 * on an audio track produced no sound at all in preview and only appeared in
 * the export mix.
 */

import { AudioBufferSink } from "mediabunny";
import type { ContentKey } from "@/model/ids";
import { getAsset } from "@/media/asset-registry";

/**
 * Longest file decoded whole. Ten minutes of 48kHz stereo is ~230 MB, which is
 * already generous; beyond this the file needs streaming rather than a bigger
 * number here.
 */
const MAX_WHOLE_DECODE_SEC = 10 * 60;

const buffers = new Map<ContentKey, AudioBuffer>();
const pending = new Map<ContentKey, Promise<AudioBuffer | null>>();
const failed = new Map<ContentKey, string>();

export function getCachedAudio(assetId: ContentKey): AudioBuffer | null {
  return buffers.get(assetId) ?? null;
}

export function audioProblem(assetId: ContentKey): string | null {
  return failed.get(assetId) ?? null;
}

/**
 * Concatenates every decoded chunk into one buffer.
 *
 * `sampleRate` is the *sequence* rate, not the file's: mixing buffers of
 * different rates in one graph is what produces pitch-shifted audio, so
 * everything is resampled to the project's rate on the way in.
 */
async function decodeWhole(
  assetId: ContentKey,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  const asset = getAsset(assetId);
  if (!asset?.audioTrack) return null;

  if (!(await asset.audioTrack.canDecode())) {
    failed.set(
      assetId,
      `This browser cannot decode ${asset.probe.audio?.codec ?? "this audio"}.`,
    );
    return null;
  }

  const durationSec = asset.probe.durationSec;
  if (durationSec > MAX_WHOLE_DECODE_SEC) {
    failed.set(
      assetId,
      `Audio longer than ${MAX_WHOLE_DECODE_SEC / 60} minutes is not supported yet.`,
    );
    return null;
  }

  const sink = new AudioBufferSink(asset.audioTrack);
  const chunks: { buffer: AudioBuffer; timestamp: number }[] = [];
  let channels = 0;

  for await (const wrapped of sink.buffers()) {
    chunks.push({ buffer: wrapped.buffer, timestamp: wrapped.timestamp });
    channels = Math.max(channels, wrapped.buffer.numberOfChannels);
  }
  if (chunks.length === 0) return null;

  const last = chunks[chunks.length - 1];
  const totalSec = last.timestamp + last.buffer.duration;
  const length = Math.max(1, Math.ceil(totalSec * sampleRate));

  // OfflineAudioContext does the resampling for us and gives an exact result.
  const context = new OfflineAudioContext(channels || 1, length, sampleRate);
  for (const chunk of chunks) {
    const source = context.createBufferSource();
    source.buffer = chunk.buffer;
    source.connect(context.destination);
    source.start(chunk.timestamp);
  }
  return context.startRendering();
}

/**
 * Decoded audio for an asset, decoding it if necessary.
 *
 * Concurrent callers share one decode. A failure is recorded and not retried —
 * the file is undecodable, not transiently unavailable.
 */
export function loadAudio(
  assetId: ContentKey,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  const cached = buffers.get(assetId);
  if (cached) return Promise.resolve(cached);
  if (failed.has(assetId)) return Promise.resolve(null);

  let inFlight = pending.get(assetId);
  if (!inFlight) {
    inFlight = decodeWhole(assetId, sampleRate)
      .then((buffer) => {
        if (buffer) buffers.set(assetId, buffer);
        return buffer;
      })
      .catch((error: unknown) => {
        failed.set(
          assetId,
          error instanceof Error ? error.message : "Audio could not be decoded.",
        );
        return null;
      })
      .finally(() => pending.delete(assetId));
    pending.set(assetId, inFlight);
  }
  return inFlight;
}

export function forgetAudio(assetId: ContentKey): void {
  buffers.delete(assetId);
  failed.delete(assetId);
}

export function forgetAllAudio(): void {
  buffers.clear();
  failed.clear();
  pending.clear();
}

export function audioCacheStats() {
  let bytes = 0;
  for (const buffer of buffers.values()) {
    bytes += buffer.length * buffer.numberOfChannels * 4;
  }
  return { assets: buffers.size, bytes, failed: failed.size };
}
