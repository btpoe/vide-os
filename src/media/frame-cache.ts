/**
 * Refcounted cache of decoded video frames.
 *
 * A `VideoSample` wraps a `VideoFrame`, which holds a GPU or system-memory
 * buffer that the garbage collector will not reclaim. Leak enough of them and
 * the browser stops handing out decoders — quietly, mid-edit. So every frame
 * here is refcounted, released explicitly, and *counted*: `openFrameCount()`
 * reports created-minus-closed, surfaced in the debug HUD and asserted to be
 * zero after dispose in the browser tests.
 *
 * Hoping for `.close()` discipline does not work. Measuring it does.
 */

import type { VideoSample } from "mediabunny";

/** Rough bytes for a decoded frame, used only for the eviction budget. */
function estimateBytes(sample: VideoSample): number {
  // 4:2:0 is 1.5 bytes per pixel; assume the worst at 4 and let the budget be
  // conservative rather than optimistic.
  return sample.codedWidth * sample.codedHeight * 4;
}

interface Entry {
  key: string;
  sample: VideoSample;
  bytes: number;
  refs: number;
  /** Monotonic counter for LRU ordering. */
  usedAt: number;
}

export interface FrameCacheStats {
  entries: number;
  bytes: number;
  budgetBytes: number;
  created: number;
  closed: number;
  open: number;
  hits: number;
  misses: number;
}

let created = 0;
let closed = 0;

/**
 * Frames currently open — created and not yet closed.
 *
 * A cached frame is legitimately open, so a non-zero count during use is
 * expected. What matters is that it returns to **zero after dispose**; that is
 * asserted at the end of every browser test, and it is the only reliable way
 * to know `.close()` discipline is being kept.
 */
export function openFrameCount(): number {
  return created - closed;
}

export class FrameCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private tick = 0;
  private hits = 0;
  private misses = 0;

  constructor(private budgetBytes: number) {}

  static key(assetId: string, frame: number): string {
    return `${assetId}:${frame}`;
  }

  /**
   * Takes a reference to a cached frame, or returns null.
   *
   * The caller **must** call `release` with the same key. Use a `finally`.
   */
  acquire(key: string): VideoSample | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    entry.refs++;
    entry.usedAt = ++this.tick;
    this.hits++;
    return entry.sample;
  }

  /** Looks without taking a reference — for cheap "is it there" checks. */
  peek(key: string): boolean {
    return this.entries.has(key);
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
  }

  /**
   * Stores a frame and takes the caller's reference to it.
   *
   * Ownership transfers: the cache closes the sample when it is evicted. If a
   * frame for this key is already present the newcomer is closed immediately,
   * because two decodes of the same frame are interchangeable and keeping both
   * would double the memory for nothing.
   */
  insert(key: string, sample: VideoSample): VideoSample {
    const existing = this.entries.get(key);
    if (existing) {
      sample.close();
      closed++;
      existing.refs++;
      existing.usedAt = ++this.tick;
      return existing.sample;
    }

    created++;
    const bytes = estimateBytes(sample);
    this.entries.set(key, { key, sample, bytes, refs: 1, usedAt: ++this.tick });
    this.bytes += bytes;
    this.evictIfNeeded();
    return sample;
  }

  /**
   * Drops least-recently-used frames until the cache is under budget.
   *
   * Only unreferenced frames can go: evicting one still being uploaded to a
   * texture would close it out from under the renderer.
   */
  private evictIfNeeded(): void {
    if (this.bytes <= this.budgetBytes) return;

    const candidates = [...this.entries.values()]
      .filter((e) => e.refs === 0)
      .sort((a, b) => a.usedAt - b.usedAt);

    for (const entry of candidates) {
      if (this.bytes <= this.budgetBytes) break;
      this.entries.delete(entry.key);
      this.bytes -= entry.bytes;
      entry.sample.close();
      closed++;
    }
  }

  /** Drops every frame for an asset — called when its decoder is evicted. */
  evictAsset(assetId: string): void {
    const prefix = `${assetId}:`;
    for (const entry of [...this.entries.values()]) {
      if (!entry.key.startsWith(prefix)) continue;
      // A referenced frame is still in use; leave it and let the next
      // eviction pass take it.
      if (entry.refs > 0) continue;
      this.entries.delete(entry.key);
      this.bytes -= entry.bytes;
      entry.sample.close();
      closed++;
    }
  }

  setBudget(bytes: number): void {
    this.budgetBytes = bytes;
    this.evictIfNeeded();
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.sample.close();
      closed++;
    }
    this.entries.clear();
    this.bytes = 0;
  }

  stats(): FrameCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      budgetBytes: this.budgetBytes,
      created,
      closed,
      open: openFrameCount(),
      hits: this.hits,
      misses: this.misses,
    };
  }
}

/** Test hook: resets the global create/close tally. */
export function resetLeakCounters(): void {
  created = 0;
  closed = 0;
}
