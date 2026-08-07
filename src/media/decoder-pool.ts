/**
 * A bounded pool of clip decoders.
 *
 * Every live `VideoDecoder` costs memory and, on some platforms, a hardware
 * decode slot — Chrome refuses new ones somewhere north of seventy. The old
 * frame source kept one `<video>` element per media file with no eviction at
 * all, so a large media pool eventually hit that ceiling and simply stopped
 * producing frames, with no error.
 *
 * Decoders are created on demand and the least recently used are dropped once
 * the pool is over budget.
 */

import type { ContentKey } from "@/model/ids";
import { ClipDecoder } from "./clip-decoder";
import { FrameCache } from "./frame-cache";
import { getAsset } from "./asset-registry";

/** Concurrent decoders. Well under the browser's ceiling, with room to spare. */
export const PREVIEW_DECODER_BUDGET = 6;
/** Export runs one clip at a time, so it needs far fewer. */
export const EXPORT_DECODER_BUDGET = 3;

/** Decoded-frame budget. Roughly forty 1080p frames. */
const DEFAULT_CACHE_BYTES = 320 * 1024 * 1024;

export class DecoderPool {
  private readonly decoders = new Map<string, ClipDecoder>();
  readonly cache: FrameCache;

  constructor(
    private budget = PREVIEW_DECODER_BUDGET,
    cacheBytes = DEFAULT_CACHE_BYTES,
  ) {
    this.cache = new FrameCache(cacheBytes);
  }

  /**
   * The decoder for a clip, created if needed.
   *
   * Keyed by clip id, not asset id: two clips of one file need separate
   * decoders so their positions do not collide.
   */
  acquire(clipId: string, assetId: ContentKey, fps: number): ClipDecoder | null {
    const existing = this.decoders.get(clipId);
    if (existing) return existing;

    const asset = getAsset(assetId);
    if (!asset?.videoTrack) return null;

    const decoder = new ClipDecoder({
      assetId,
      track: asset.videoTrack,
      cache: this.cache,
      fps,
    });
    this.decoders.set(clipId, decoder);
    this.evictIfNeeded(clipId);
    return decoder;
  }

  /** Existing decoder for a clip, without creating one. */
  peek(clipId: string): ClipDecoder | undefined {
    return this.decoders.get(clipId);
  }

  /**
   * Drops decoders beyond the budget, oldest first.
   *
   * `keepClipId` is never evicted: it is the one being created, and dropping it
   * immediately would make the pool useless at budget size 1.
   */
  private evictIfNeeded(keepClipId?: string): void {
    if (this.decoders.size <= this.budget) return;

    const candidates = [...this.decoders.entries()]
      .filter(([id]) => id !== keepClipId)
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

    for (const [id, decoder] of candidates) {
      if (this.decoders.size <= this.budget) break;
      decoder.dispose();
      this.decoders.delete(id);
    }
  }

  /**
   * Keeps only the decoders for clips near the playhead.
   *
   * Called as the playhead moves, so a long timeline does not accumulate a
   * decoder for every clip ever visited.
   */
  retain(activeClipIds: Iterable<string>): void {
    const keep = new Set(activeClipIds);
    for (const [id, decoder] of [...this.decoders.entries()]) {
      if (keep.has(id)) continue;
      decoder.dispose();
      this.decoders.delete(id);
    }
  }

  release(clipId: string): void {
    const decoder = this.decoders.get(clipId);
    if (!decoder) return;
    decoder.dispose();
    this.decoders.delete(clipId);
  }

  dispose(): void {
    for (const decoder of this.decoders.values()) decoder.dispose();
    this.decoders.clear();
    this.cache.clear();
  }

  stats() {
    return {
      decoders: this.decoders.size,
      budget: this.budget,
      cache: this.cache.stats(),
    };
  }
}
