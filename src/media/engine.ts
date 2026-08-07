/**
 * The media engine facade.
 *
 * Everything above this line asks for "the frame of this clip at this timeline
 * frame" and gets back something drawable. Everything below is demuxers,
 * decoders, caches and eviction.
 *
 * Every method is async and every payload is structured-cloneable or
 * transferable, even where that is not needed today. That is deliberate: it is
 * what lets the whole engine move behind a worker later by swapping the
 * transport rather than rewriting the call sites. `VideoFrame` is transferable,
 * so the boundary holds.
 */

import type { VideoSample } from "mediabunny";
import type { Clip, ProjectDoc } from "@/model/doc";
import { sourceFrameAt } from "@/model/doc";
import type { ContentKey } from "@/model/ids";
import { frameRateToNumber } from "@/lib/timecode";
import {
  getAsset,
  registerFromBlob,
  registerFromFileRef,
  type RegisteredAsset,
} from "./asset-registry";
import { DecoderPool } from "./decoder-pool";
import { leakCount } from "./frame-cache";
import type { FileRef } from "@/platform";

/** A frame borrowed from the cache. Must be released. */
export interface BorrowedFrame {
  sample: VideoSample;
  /** The source frame actually returned, which may lag the one requested. */
  sourceFrame: number;
  /** Whether this is the exact frame asked for, or a stand-in. */
  exact: boolean;
  release: () => void;
}

export class MediaEngine {
  private readonly pool: DecoderPool;

  constructor(budget?: number) {
    this.pool = new DecoderPool(budget);
  }

  // ── Assets ──────────────────────────────────────────────────────────

  async openFile(id: ContentKey, ref: FileRef): Promise<RegisteredAsset> {
    return registerFromFileRef(id, ref);
  }

  async openBlob(id: ContentKey, blob: Blob): Promise<RegisteredAsset> {
    return registerFromBlob(id, blob);
  }

  asset(id: ContentKey): RegisteredAsset | undefined {
    return getAsset(id);
  }

  // ── Frames ──────────────────────────────────────────────────────────

  private decoderFor(doc: ProjectDoc, clip: Clip) {
    if (clip.source.type !== "asset") return null;
    const fps = frameRateToNumber(doc.sequence.frameRate);
    return this.pool.acquire(clip.id, clip.source.assetId, fps);
  }

  /**
   * The exact frame of a clip at a timeline position. Waits for a decode.
   *
   * Used by export, and by preview once a scrub settles. This is the only
   * variant that can be relied on to be frame-accurate.
   */
  async getExact(
    doc: ProjectDoc,
    clip: Clip,
    timelineFrame: number,
  ): Promise<BorrowedFrame | null> {
    const decoder = this.decoderFor(doc, clip);
    if (!decoder) return null;

    const sourceFrame = sourceFrameAt(clip, timelineFrame);
    const sample = await decoder.getExact(sourceFrame);
    if (!sample) return null;

    return {
      sample,
      sourceFrame,
      exact: true,
      release: () => decoder.release(sourceFrame),
    };
  }

  /**
   * A frame if one is already decoded, otherwise the nearest earlier one,
   * otherwise nothing. **Never waits.**
   *
   * This is what makes the preview loop safe: it renders at a steady rate and
   * repeats a frame when the decoder is behind, rather than awaiting mid-render
   * and letting the next frame's render overlap with it.
   */
  tryGet(doc: ProjectDoc, clip: Clip, timelineFrame: number): BorrowedFrame | null {
    const decoder = this.decoderFor(doc, clip);
    if (!decoder) return null;

    const sourceFrame = sourceFrameAt(clip, timelineFrame);

    const exact = decoder.tryGet(sourceFrame);
    if (exact) {
      return {
        sample: exact,
        sourceFrame,
        exact: true,
        release: () => decoder.release(sourceFrame),
      };
    }

    const nearest = decoder.tryGetNearest(sourceFrame);
    if (nearest) {
      return {
        sample: nearest.sample,
        sourceFrame: nearest.frame,
        exact: false,
        release: () => decoder.release(nearest.frame),
      };
    }

    // Nothing available: kick off a decode so the next attempt can succeed.
    void decoder.getExact(sourceFrame).then((sample) => {
      if (sample) decoder.release(sourceFrame);
    });
    return null;
  }

  /** Warms the cache ahead of the playhead for the clips about to be needed. */
  prefetch(doc: ProjectDoc, clips: readonly Clip[], timelineFrame: number): void {
    for (const clip of clips) {
      const decoder = this.decoderFor(doc, clip);
      decoder?.prefetch(sourceFrameAt(clip, timelineFrame));
    }
  }

  /**
   * Limits live decoders to the clips given.
   *
   * Called as the playhead moves so a long timeline does not accumulate one
   * decoder per clip ever visited.
   */
  retain(clipIds: Iterable<string>): void {
    this.pool.retain(clipIds);
  }

  // ── Diagnostics ─────────────────────────────────────────────────────

  stats() {
    return { ...this.pool.stats(), leaked: leakCount() };
  }

  dispose(): void {
    this.pool.dispose();
  }
}

/**
 * The engine the preview uses. Export creates its own with a smaller decoder
 * budget so a background export cannot starve the editor.
 */
export const mediaEngine = new MediaEngine();
