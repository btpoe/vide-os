/**
 * Frame source: decode video/image frames from media file handles.
 * Uses HTMLVideoElement for video, HTMLImageElement for images.
 * Manages a cache of decoded sources for efficient playback.
 */

import { getFileFromHandle } from "@/lib/fs-access";
import type { MediaEntry } from "@/stores/media-store";

export interface FrameSource {
  type: "video" | "image" | "audio" | "color";
  element?: HTMLVideoElement | HTMLImageElement;
  objectUrl?: string;
  width: number;
  height: number;
  duration: number;
  ready: boolean;
}

const sourceCache = new Map<string, FrameSource>();
const pendingLoads = new Map<string, Promise<FrameSource>>();

/**
 * Get or create a frame source for a media entry.
 * Returns immediately if cached, otherwise loads asynchronously.
 */
export async function getFrameSource(entry: MediaEntry): Promise<FrameSource> {
  const cached = sourceCache.get(entry.id);
  if (cached?.ready) return cached;

  // Avoid duplicate loads
  const pending = pendingLoads.get(entry.id);
  if (pending) return pending;

  const promise = loadFrameSource(entry);
  pendingLoads.set(entry.id, promise);

  try {
    const source = await promise;
    sourceCache.set(entry.id, source);
    return source;
  } finally {
    pendingLoads.delete(entry.id);
  }
}

/**
 * Get a cached frame source synchronously (returns null if not loaded).
 */
export function getCachedFrameSource(mediaId: string): FrameSource | null {
  const cached = sourceCache.get(mediaId);
  return cached?.ready ? cached : null;
}

/**
 * Preload frame sources for a list of media entries.
 */
export async function preloadFrameSources(entries: MediaEntry[]): Promise<void> {
  await Promise.allSettled(entries.map((e) => getFrameSource(e)));
}

/**
 * Seek a video frame source to a specific time.
 */
export function seekFrameSource(source: FrameSource, time: number): Promise<void> {
  if (source.type !== "video" || !source.element) return Promise.resolve();
  const video = source.element as HTMLVideoElement;

  return new Promise<void>((resolve) => {
    const clampedTime = Math.max(0, Math.min(time, video.duration || 0));

    // If already at this time (within a frame), skip
    if (Math.abs(video.currentTime - clampedTime) < 0.02) {
      resolve();
      return;
    }

    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = clampedTime;
  });
}

/**
 * Release a frame source and free its resources.
 */
export function releaseFrameSource(mediaId: string): void {
  const source = sourceCache.get(mediaId);
  if (!source) return;

  if (source.objectUrl) {
    URL.revokeObjectURL(source.objectUrl);
  }
  if (source.element) {
    if (source.element instanceof HTMLVideoElement) {
      source.element.pause();
      source.element.src = "";
      source.element.load();
    }
  }
  sourceCache.delete(mediaId);
}

/**
 * Release all frame sources.
 */
export function releaseAllFrameSources(): void {
  for (const id of sourceCache.keys()) {
    releaseFrameSource(id);
  }
}

/**
 * Create a solid black frame source (for gaps/placeholders).
 *
 * Took r/g/b parameters that it never read — FrameSource has no colour field,
 * so this has only ever produced black.
 */
export function createColorSource(): FrameSource {
  return {
    type: "color",
    width: 1,
    height: 1,
    duration: Infinity,
    ready: true,
  };
}

// ── Internal ────────────────────────────────────────────────────────

async function loadFrameSource(entry: MediaEntry): Promise<FrameSource> {
  const file = await getFileFromHandle(entry.handle);
  const objectUrl = URL.createObjectURL(file);
  const mediaType = entry.type;

  if (mediaType === "video") {
    return loadVideoSource(objectUrl, entry);
  } else if (mediaType === "image") {
    return loadImageSource(objectUrl, entry);
  } else if (mediaType === "audio") {
    return {
      type: "audio",
      objectUrl,
      width: 0,
      height: 0,
      duration: entry.duration || 0,
      ready: true,
    };
  }

  return createColorSource();
}

function loadVideoSource(objectUrl: string, entry: MediaEntry): Promise<FrameSource> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    const onReady = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);

      const source: FrameSource = {
        type: "video",
        element: video,
        objectUrl,
        width: video.videoWidth || entry.width || 1920,
        height: video.videoHeight || entry.height || 1080,
        duration: video.duration || entry.duration || 0,
        ready: true,
      };
      resolve(source);
    };

    const onError = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load video: ${entry.name}`));
    };

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
    video.src = objectUrl;
  });
}

function loadImageSource(objectUrl: string, entry: MediaEntry): Promise<FrameSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const source: FrameSource = {
        type: "image",
        element: img,
        objectUrl,
        width: img.naturalWidth || entry.width || 1920,
        height: img.naturalHeight || entry.height || 1080,
        duration: Infinity,
        ready: true,
      };
      resolve(source);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image: ${entry.name}`));
    };

    img.src = objectUrl;
  });
}
