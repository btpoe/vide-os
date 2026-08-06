/**
 * Audio manager: syncs audio from HTMLVideoElement frame sources
 * with the playback engine's playhead position.
 *
 * Video elements are loaded muted (required for autoplay/texImage2D).
 * During playback, this manager unmutes active clips and keeps their
 * currentTime in sync. When paused or when a clip is no longer active,
 * the element is re-muted and paused.
 */

import { projectState, type Clip, type Track } from "@/stores/project-store";
import { mediaState } from "@/stores/media-store";
import { getCachedFrameSource } from "./frame-source";

/** Set of mediaIds currently playing audio. */
const activeAudio = new Set<string>();

/**
 * Sync audio for the current playhead position.
 * Call this every frame from the render loop.
 */
export function syncAudio(time: number, isPlaying: boolean): void {
  if (!isPlaying) {
    muteAll();
    return;
  }

  // Collect all clips that should be audible right now
  const audibleClips = new Map<string, { clip: Clip; track: Track }>();

  for (const track of projectState.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (time >= clip.startTime && time < clip.startTime + clip.duration) {
        const entry = mediaState.entries.find((e) => e.id === clip.mediaId);
        if (entry && (entry.type === "video" || entry.type === "audio")) {
          audibleClips.set(clip.mediaId, { clip, track });
        }
      }
    }
  }

  // Mute clips that are no longer active
  for (const mediaId of activeAudio) {
    if (!audibleClips.has(mediaId)) {
      muteSource(mediaId);
      activeAudio.delete(mediaId);
    }
  }

  // Unmute and sync active clips
  for (const [mediaId, { clip }] of audibleClips) {
    const source = getCachedFrameSource(mediaId);
    if (!source || source.type !== "video" || !source.element) continue;

    const video = source.element as HTMLVideoElement;
    const mediaTime = clip.inPoint + (time - clip.startTime);

    if (!activeAudio.has(mediaId)) {
      // Start audio playback
      video.muted = false;
      video.currentTime = mediaTime;
      video.play().catch(() => {
        // Autoplay blocked — browser requires user gesture first
        video.muted = true;
      });
      activeAudio.add(mediaId);
    } else {
      // Keep in sync — correct drift > 0.15s
      const drift = Math.abs(video.currentTime - mediaTime);
      if (drift > 0.15) {
        video.currentTime = mediaTime;
      }
      // Ensure it's actually playing
      if (video.paused) {
        video.play().catch(() => {});
      }
    }
  }
}

/**
 * Mute all currently-playing audio sources.
 */
export function muteAll(): void {
  for (const mediaId of activeAudio) {
    muteSource(mediaId);
  }
  activeAudio.clear();
}

function muteSource(mediaId: string): void {
  const source = getCachedFrameSource(mediaId);
  if (!source || source.type !== "video" || !source.element) return;
  const video = source.element as HTMLVideoElement;
  video.muted = true;
  video.pause();
}
