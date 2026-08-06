/**
 * Clip thumbnail generator.
 * Generates a small thumbnail image from a video file for timeline display.
 */

const thumbnailCache = new Map<string, string>(); // mediaId -> dataURL
const pendingThumbnails = new Map<string, Promise<string | null>>();

const THUMB_WIDTH = 80;
const THUMB_HEIGHT = 45;

/**
 * Get or generate a thumbnail for a media entry.
 */
export async function getClipThumbnail(
  mediaId: string,
  file: File,
): Promise<string | null> {
  const cached = thumbnailCache.get(mediaId);
  if (cached) return cached;

  const pending = pendingThumbnails.get(mediaId);
  if (pending) return pending;

  const promise = generateThumbnail(file);
  pendingThumbnails.set(mediaId, promise);

  try {
    const result = await promise;
    if (result) thumbnailCache.set(mediaId, result);
    return result;
  } finally {
    pendingThumbnails.delete(mediaId);
  }
}

/**
 * Get cached thumbnail synchronously.
 */
export function getCachedThumbnail(mediaId: string): string | null {
  return thumbnailCache.get(mediaId) ?? null;
}

/**
 * Generate a thumbnail from a video file at 0.5s.
 */
async function generateThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";

    const url = URL.createObjectURL(file);
    video.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.onloadeddata = () => {
      // Seek to 0.5s or 10% of duration, whichever is smaller
      video.currentTime = Math.min(0.5, video.duration * 0.1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = THUMB_WIDTH;
        canvas.height = THUMB_HEIGHT;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
        cleanup();
        resolve(dataUrl);
      } catch {
        cleanup();
        resolve(null);
      }
    };

    // Timeout fallback
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);
  });
}

/**
 * Clear all cached thumbnails.
 */
export function clearAllThumbnails(): void {
  thumbnailCache.clear();
}
