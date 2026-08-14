/**
 * Background generation of clip decorations — waveform peaks and filmstrip
 * thumbnails.
 *
 * These used to be kicked off from inside the timeline's JSX render body, so
 * every reconcile re-fired them and rendering had side effects. Here they are
 * requests into a concurrency-limited queue, and a version signal tells the UI
 * when new results are available.
 *
 * The queue was the only part of this that Phase 2 actually delivered; the two
 * generators behind it were the untouched originals until the decoration
 * rewrite. Both now go through the media engine's demuxer stack and cache their
 * results to OPFS, so the second launch of a project draws its decorations
 * without decoding anything.
 *
 * Nothing here throws: a decoration that cannot be produced is simply absent.
 * A clip with no waveform is a cosmetic loss, not a failure.
 */

import { createSignal } from "solid-js";
import { getCachedWaveform, getWaveform } from "./waveform-cache";
import { getCachedFilmstrip, getFilmstrip } from "./clip-thumbnails";
import { entryFile, mediaState } from "@/stores/media-store";

/** Bumped whenever a decoration finishes, so views can re-read the caches. */
const [previewVersion, bumpVersion] = createSignal(0);
export { previewVersion };

/**
 * Concurrent decoration jobs.
 *
 * Waveform analysis is off the main thread now, but each job still holds a
 * demuxer and a decoder, so the cap is about media resources rather than about
 * JS time.
 */
const MAX_CONCURRENT = 3;

type Job = () => Promise<void>;

const queue: Job[] = [];
const requested = new Set<string>();
let running = 0;

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    running++;
    void job()
      .catch(() => undefined)
      .finally(() => {
        running--;
        pump();
      });
  }
}

function enqueue(key: string, job: Job): void {
  // One attempt per media per kind. A failure is not retried — the file is
  // usually undecodable rather than transiently unavailable.
  if (requested.has(key)) return;
  requested.add(key);
  queue.push(job);
  pump();
}

/**
 * Requests waveform peaks if none are cached. Safe to call from an effect on
 * every visible clip; repeated calls for the same media collapse into one job.
 */
export function requestWaveform(mediaId: string): void {
  if (getCachedWaveform(mediaId)) return;
  const entry = mediaState.entries.find((e) => e.id === mediaId);
  if (!entry) return;

  enqueue(`waveform:${mediaId}`, async () => {
    const file = await entryFile(entry);
    if (!file) return;
    await getWaveform(mediaId, file);
    bumpVersion((v) => v + 1);
  });
}

/** Requests a filmstrip. Stills get a one-tile strip; audio gets none. */
export function requestThumbnail(mediaId: string): void {
  if (getCachedFilmstrip(mediaId)) return;
  const entry = mediaState.entries.find((e) => e.id === mediaId);
  if (!entry) return;
  if (entry.type !== "video" && entry.type !== "image") return;
  const kind = entry.type;

  enqueue(`thumb:${mediaId}`, async () => {
    const file = await entryFile(entry);
    if (!file) return;
    await getFilmstrip(mediaId, file, kind);
    bumpVersion((v) => v + 1);
  });
}

/** Test/reset hook: forgets which decorations have been attempted. */
export function resetPreviewRequests(): void {
  queue.length = 0;
  requested.clear();
}
