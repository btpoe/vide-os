/**
 * A decoder for one clip on the timeline.
 *
 * The unit of decode is a *clip instance*, not a media file. The previous
 * implementation kept one `<video>` element per file, so two clips of the same
 * source — a split, or a video and its detached audio — fought over one
 * element's `currentTime` and the last seek won. Here they get separate
 * decoders and cannot interfere.
 *
 * Three ways to ask for a frame, because preview, scrubbing and export want
 * genuinely different trade-offs:
 *
 * - `getExact` waits for the frame containing the timestamp. Export uses this;
 *   nothing else can be deterministic.
 * - `tryGet` never waits. It returns a cached frame or nothing, so the preview
 *   loop can render at a steady rate and simply repeat a frame when the decoder
 *   is behind.
 * - `getNearest` waits, but accepts the closest keyframe rather than decoding
 *   forward to an exact one. Scrubbing uses it, then settles to exact when the
 *   drag stops.
 */

import { VideoSampleSink, type InputVideoTrack, type VideoSample } from "mediabunny";
import { FrameCache } from "./frame-cache";

/** How far ahead to decode during playback, in seconds. */
const LOOKAHEAD_SEC = 0.5;

export interface ClipDecoderOptions {
  assetId: string;
  track: InputVideoTrack;
  cache: FrameCache;
  /** Frames per second of the sequence, for cache keying. */
  fps: number;
}

export class ClipDecoder {
  private readonly sink: VideoSampleSink;
  private readonly assetId: string;
  private readonly cache: FrameCache;
  private readonly fps: number;

  /** In-flight exact fetches, keyed by frame, so duplicates share one decode. */
  private readonly pending = new Map<number, Promise<VideoSample | null>>();

  /** Set while a lookahead pass is running, so only one runs at a time. */
  private prefetching = false;

  private disposed = false;
  lastUsedAt = 0;

  constructor(options: ClipDecoderOptions) {
    this.assetId = options.assetId;
    this.cache = options.cache;
    this.fps = options.fps;
    this.sink = new VideoSampleSink(options.track);
  }

  private keyFor(frame: number): string {
    return FrameCache.key(this.assetId, frame);
  }

  private frameToSeconds(frame: number): number {
    return frame / this.fps;
  }

  /**
   * The frame at a source frame index, decoded if necessary.
   *
   * The returned sample is *borrowed*: call `release` with the same frame when
   * finished, or the cache can never evict it.
   */
  async getExact(frame: number): Promise<VideoSample | null> {
    if (this.disposed) return null;
    this.lastUsedAt = performance.now();

    const key = this.keyFor(frame);
    const cached = this.cache.acquire(key);
    if (cached) return cached;

    // Collapse concurrent requests for the same frame into one decode.
    const inFlight = this.pending.get(frame);
    if (inFlight) {
      const sample = await inFlight;
      // The winner inserted it; take our own reference.
      return sample ? this.cache.acquire(key) : null;
    }

    const request = this.decode(frame, key);
    this.pending.set(frame, request);
    try {
      return await request;
    } finally {
      this.pending.delete(frame);
    }
  }

  private async decode(frame: number, key: string): Promise<VideoSample | null> {
    try {
      const sample = await this.sink.getSample(this.frameToSeconds(frame));
      if (!sample) return null;
      if (this.disposed) {
        sample.close();
        return null;
      }
      return this.cache.insert(key, sample);
    } catch {
      // A decode failure is per-frame, not fatal: the compositor draws nothing
      // for this layer and the rest of the timeline carries on.
      return null;
    }
  }

  /**
   * A cached frame, or null. Never waits.
   *
   * The preview scheduler uses this so it can never stall on a decode; the
   * render loop that awaited frame fetches is why concurrent renders used to
   * overlap and corrupt shared GL state.
   */
  tryGet(frame: number): VideoSample | null {
    if (this.disposed) return null;
    this.lastUsedAt = performance.now();
    return this.cache.acquire(this.keyFor(frame));
  }

  /** Most recent cached frame at or before `frame`, within `maxBackFrames`. */
  tryGetNearest(
    frame: number,
    maxBackFrames = 30,
  ): { sample: VideoSample; frame: number } | null {
    if (this.disposed) return null;
    for (let f = frame; f >= Math.max(0, frame - maxBackFrames); f--) {
      const sample = this.cache.acquire(this.keyFor(f));
      if (sample) {
        this.lastUsedAt = performance.now();
        return { sample, frame: f };
      }
    }
    return null;
  }

  release(frame: number): void {
    this.cache.release(this.keyFor(frame));
  }

  /**
   * Decodes ahead of the playhead so `tryGet` keeps hitting during playback.
   *
   * Fire-and-forget, and self-limiting: one pass at a time, and it stops as
   * soon as the decoder is disposed.
   */
  prefetch(fromFrame: number): void {
    if (this.disposed || this.prefetching) return;
    this.prefetching = true;

    void (async () => {
      try {
        const start = this.frameToSeconds(fromFrame);
        const end = start + LOOKAHEAD_SEC;
        for await (const sample of this.sink.samples(start, end)) {
          if (this.disposed) {
            sample.close();
            break;
          }
          const frame = Math.round(sample.timestamp * this.fps);
          const key = this.keyFor(frame);
          if (this.cache.peek(key)) {
            // Already have it; the cache would close the duplicate anyway, but
            // skipping avoids the churn.
            sample.close();
            continue;
          }
          // Insert takes a reference on our behalf; drop it straight away so
          // the frame is evictable — the point is to warm the cache, not hold it.
          this.cache.insert(key, sample);
          this.cache.release(key);
        }
      } catch {
        // Prefetch is best-effort by definition.
      } finally {
        this.prefetching = false;
      }
    })();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cache.evictAsset(this.assetId);
  }
}
