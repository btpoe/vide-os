/**
 * Where waveform peaks come from, in order of cost.
 *
 * Memory, then OPFS, then a worker that decodes the file. The middle step is
 * what the old implementation lacked: its cache was an in-memory `Map`, so every
 * reload re-decoded every file in the project. Peaks are derived data keyed by
 * content, which is exactly what `platform.cache` is for — the same store
 * autosave already uses.
 *
 * The analysis itself runs in a worker. If one cannot be started the same code
 * runs inline, because a waveform is a decoration and losing it is worse than
 * briefly blocking.
 */

import WaveformWorker from "../media/waveform-worker?worker";
import type { WaveformRequest, WaveformResponse } from "@/media/waveform-worker";
import { analyseWaveformBlob } from "@/media/waveform-analysis";
import { platform } from "@/platform";
import type { Bytes, CacheStore } from "@/platform/types";
import { deserialisePyramid, type PeakPyramid } from "./waveform";

const CACHE_NAME = "waveforms";

const pyramids = new Map<string, PeakPyramid>();
const pending = new Map<string, Promise<PeakPyramid | null>>();
/** Assets with no analysable audio. Recorded so they are attempted once. */
const unavailable = new Set<string>();

export function getCachedWaveform(assetId: string): PeakPyramid | null {
  return pyramids.get(assetId) ?? null;
}

// ── The worker ────────────────────────────────────────────────────────

/**
 * What came back from the worker.
 *
 * `ran` distinguishes "the worker looked and this file has no analysable audio"
 * from "there is no worker". Collapsing the two would make every audio-less
 * video — most video — get demuxed and scanned a second time inline for nothing.
 */
type WorkerOutcome = { ran: boolean; bytes: Bytes | null };

const NO_WORKER: WorkerOutcome = { ran: false, bytes: null };

let worker: Worker | null = null;
let workerBroken = false;
let nextRequestId = 1;
const inFlight = new Map<number, (outcome: WorkerOutcome) => void>();

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;

  try {
    const created = new WaveformWorker();
    created.addEventListener("message", (event: MessageEvent<WaveformResponse>) => {
      const settle = inFlight.get(event.data.id);
      if (!settle) return;
      inFlight.delete(event.data.id);
      settle({ ran: !event.data.error, bytes: event.data.bytes ?? null });
    });
    created.addEventListener("error", () => {
      // A worker that failed to load fails for every request, so stop asking
      // and fall back rather than hanging each caller in turn.
      workerBroken = true;
      worker = null;
      for (const settle of inFlight.values()) settle(NO_WORKER);
      inFlight.clear();
    });
    worker = created;
    return created;
  } catch {
    workerBroken = true;
    return null;
  }
}

function analyseInWorker(blob: Blob): Promise<WorkerOutcome> {
  const active = ensureWorker();
  if (!active) return Promise.resolve(NO_WORKER);

  const id = nextRequestId++;
  return new Promise<WorkerOutcome>((resolve) => {
    inFlight.set(id, resolve);
    const request: WaveformRequest = { id, blob };
    active.postMessage(request);
  });
}

/** Test hook: drops the worker so the next request starts a fresh one. */
export function resetWaveformWorker(): void {
  worker?.terminate();
  worker = null;
  workerBroken = false;
  inFlight.clear();
}

// ── The cache ─────────────────────────────────────────────────────────

let store: Promise<CacheStore> | null = null;
function decorationStore(): Promise<CacheStore> {
  store ??= platform.cache.open(CACHE_NAME);
  return store;
}

async function fromDisk(assetId: string): Promise<PeakPyramid | null> {
  try {
    const bytes = await (await decorationStore()).get(assetId);
    return bytes ? deserialisePyramid(bytes) : null;
  } catch {
    return null;
  }
}

async function analyse(assetId: string, blob: Blob): Promise<PeakPyramid | null> {
  const outcome = await analyseInWorker(blob);
  const bytes = outcome.ran ? outcome.bytes : await analyseWaveformBlob(blob);
  if (!bytes) return null;

  const pyramid = deserialisePyramid(bytes);
  if (!pyramid) return null;

  // Written after it is known to parse, so a corrupt entry is never stored, and
  // awaited rather than fired off: this already runs inside a background job, and
  // a caller that returns before the write lands cannot be told the peaks are
  // cached — which is exactly the race a test would otherwise have to sleep past.
  try {
    await (await decorationStore()).set(assetId, bytes);
  } catch {
    // A full or unavailable cache costs a recompute next launch, nothing more.
  }

  return pyramid;
}

/**
 * Peaks for an asset, from whichever tier has them.
 *
 * Concurrent callers share one analysis. A file with no analysable audio is
 * recorded and never attempted again — that is a property of the file, not a
 * transient failure.
 */
export function getWaveform(assetId: string, blob: Blob): Promise<PeakPyramid | null> {
  const cached = pyramids.get(assetId);
  if (cached) return Promise.resolve(cached);
  if (unavailable.has(assetId)) return Promise.resolve(null);

  const existing = pending.get(assetId);
  if (existing) return existing;

  const work = (async () => {
    const onDisk = await fromDisk(assetId);
    const pyramid = onDisk ?? (await analyse(assetId, blob));
    if (pyramid) pyramids.set(assetId, pyramid);
    else unavailable.add(assetId);
    return pyramid;
  })()
    .catch(() => {
      unavailable.add(assetId);
      return null;
    })
    .finally(() => pending.delete(assetId));

  pending.set(assetId, work);
  return work;
}

export function clearWaveform(assetId: string): void {
  pyramids.delete(assetId);
  unavailable.delete(assetId);
}

export function clearAllWaveforms(): void {
  pyramids.clear();
  unavailable.clear();
}

/** Drops the persisted peaks too. Only for an explicit "clear cache" action. */
export async function purgeWaveformCache(): Promise<void> {
  clearAllWaveforms();
  await (await decorationStore()).clear().catch(() => undefined);
}
