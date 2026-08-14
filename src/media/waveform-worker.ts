/**
 * The waveform analysis worker.
 *
 * The first worker in the codebase. Phase 2 wanted this and Phase 5 wanted the
 * whole media engine behind one; neither happened, and the async facade went
 * unexercised. This is the case that pays: scanning an hour of audio is the
 * longest single block of work the app does, it happens in the background while
 * someone is editing, and its result is a few megabytes of plain bytes rather
 * than a `VideoFrame` that has to be marshalled anywhere.
 *
 * The protocol is one message each way, correlated by id, with the peak bytes
 * transferred rather than copied. A blob crosses by reference, so posting one in
 * does not read the file — the worker's ranged reads do that.
 */

import { analyseWaveformBlob } from "./waveform-analysis";

export interface WaveformRequest {
  id: number;
  blob: Blob;
}

export interface WaveformResponse {
  id: number;
  /** Absent when the file has no analysable audio, or analysis failed. */
  bytes?: Uint8Array<ArrayBuffer>;
  error?: string;
}

/**
 * `globalThis` narrowed by hand rather than through `lib.webworker`: pulling
 * that lib in would collide with `lib.dom` across the rest of the program, and
 * the worker's whole surface is these two members.
 */
const ctx = globalThis as unknown as {
  postMessage(message: WaveformResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    handler: (event: MessageEvent<WaveformRequest>) => void,
  ): void;
};

ctx.addEventListener("message", (event) => {
  const { id, blob } = event.data;

  void analyseWaveformBlob(blob)
    .then((bytes) => {
      if (!bytes) {
        ctx.postMessage({ id });
        return;
      }
      ctx.postMessage({ id, bytes }, [bytes.buffer]);
    })
    .catch((error: unknown) => {
      ctx.postMessage({
        id,
        error: error instanceof Error ? error.message : "Waveform analysis failed",
      });
    });
});
