/**
 * Export engine: renders the timeline frame-by-frame to a video file
 * using canvas.captureStream() + MediaRecorder, with optional audio mixing
 * via Web Audio API.
 */

import { projectState } from "@/stores/project-store";
import { entryFile, mediaState } from "@/stores/media-store";
import { createCompositor, renderAtSeconds, disposeCompositor } from "./compositor";
import { preloadFrameSources } from "./frame-source";

export interface ExportSettings {
  format: "webm" | "mp4";
  width: number;
  height: number;
  fps: number;
  videoBitrate: number; // bps
  audioBitrate: number; // bps
  includeAudio: boolean;
}

export interface ExportProgress {
  phase: "preparing" | "rendering" | "encoding" | "complete" | "error" | "cancelled";
  currentFrame: number;
  totalFrames: number;
  percent: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  error?: string;
}

export type ExportProgressCallback = (progress: ExportProgress) => void;

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: "webm",
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrate: 8_000_000,
  audioBitrate: 128_000,
  includeAudio: true,
};

/**
 * Get the actual timeline duration (end of last clip, not padded).
 */
function getTimelineDuration(): number {
  let maxEnd = 0;
  for (const track of projectState.tracks) {
    for (const clip of track.clips) {
      maxEnd = Math.max(maxEnd, clip.startTime + clip.duration);
    }
  }
  return maxEnd;
}

/**
 * Export the timeline to a downloadable video file.
 */
export async function exportTimeline(
  settings: ExportSettings,
  onProgress: ExportProgressCallback,
): Promise<Blob | null> {
  const duration = getTimelineDuration();
  if (duration <= 0) {
    onProgress({
      phase: "error",
      currentFrame: 0,
      totalFrames: 0,
      percent: 0,
      elapsedMs: 0,
      estimatedRemainingMs: 0,
      error: "No clips on timeline to export",
    });
    return null;
  }

  const totalFrames = Math.ceil(duration * settings.fps);
  const frameDuration = 1 / settings.fps;
  const startTime = performance.now();

  // ── Phase 1: Prepare ──────────────────────────────────────────────

  onProgress({
    phase: "preparing",
    currentFrame: 0,
    totalFrames,
    percent: 0,
    elapsedMs: 0,
    estimatedRemainingMs: 0,
  });

  // Preload all media sources
  const mediaEntries = mediaState.entries.filter((e) =>
    projectState.tracks.some((t) => t.clips.some((c) => c.mediaId === e.id)),
  );
  await preloadFrameSources(mediaEntries);

  // Create offscreen canvas and compositor
  const canvas = document.createElement("canvas");
  canvas.width = settings.width;
  canvas.height = settings.height;

  const compositor = createCompositor(canvas);
  if (!compositor) {
    onProgress({
      phase: "error",
      currentFrame: 0,
      totalFrames,
      percent: 0,
      elapsedMs: performance.now() - startTime,
      estimatedRemainingMs: 0,
      error: "Failed to create WebGL2 context for export",
    });
    return null;
  }

  // ── Phase 2: Set up MediaRecorder ─────────────────────────────────

  const mimeType = getMimeType(settings.format);
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    disposeCompositor(compositor);
    onProgress({
      phase: "error",
      currentFrame: 0,
      totalFrames,
      percent: 0,
      elapsedMs: performance.now() - startTime,
      estimatedRemainingMs: 0,
      error: `Format not supported: ${mimeType}`,
    });
    return null;
  }

  const stream = canvas.captureStream(0); // 0 = manual frame capture

  // Set up audio mixing if needed
  let audioCtx: AudioContext | null = null;

  if (settings.includeAudio) {
    try {
      audioCtx = new AudioContext({ sampleRate: 48000 });

      // Pre-render the full audio mix offline
      const mixedBuffer = await mixTimelineAudio(duration, 48000);
      if (mixedBuffer && audioCtx) {
        // Create a source node that plays the mixed audio in real-time
        const audioSource = audioCtx.createBufferSource();
        audioSource.buffer = mixedBuffer;
        const dest = audioCtx.createMediaStreamDestination();
        audioSource.connect(dest);
        audioSource.start(0);

        // Add audio track to the video stream
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
        }
      }
    } catch {
      // Audio not available, continue without
    }
  }

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: settings.videoBitrate,
    audioBitsPerSecond: settings.audioBitrate,
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();

  // ── Phase 3: Render frames ────────────────────────────────────────

  let cancelled = false;

  // Store cancel function on the module level so UI can call it
  _cancelExport = () => {
    cancelled = true;
  };

  onProgress({
    phase: "rendering",
    currentFrame: 0,
    totalFrames,
    percent: 0,
    elapsedMs: performance.now() - startTime,
    estimatedRemainingMs: 0,
  });

  for (let frame = 0; frame < totalFrames; frame++) {
    if (cancelled) {
      recorder.stop();
      await recordingDone;
      disposeCompositor(compositor);
      if (audioCtx) void audioCtx.close();
      _cancelExport = null;

      onProgress({
        phase: "cancelled",
        currentFrame: frame,
        totalFrames,
        percent: (frame / totalFrames) * 100,
        elapsedMs: performance.now() - startTime,
        estimatedRemainingMs: 0,
      });
      return null;
    }

    const time = frame * frameDuration;

    // Renders whatever is already decoded — which for export is the wrong
    // guarantee, but this whole path is replaced by a deterministic encoder in
    // the next phase. Until then export remains as unreliable as it always was.
    renderAtSeconds(compositor, time);

    // Request frame capture from the stream
    const videoTrack = stream.getVideoTracks()[0] as any;
    if (videoTrack?.requestFrame) {
      videoTrack.requestFrame();
    }

    // Update progress
    const elapsed = performance.now() - startTime;
    const framesPerMs = (frame + 1) / elapsed;
    const remaining = (totalFrames - frame - 1) / framesPerMs;

    onProgress({
      phase: "rendering",
      currentFrame: frame + 1,
      totalFrames,
      percent: ((frame + 1) / totalFrames) * 100,
      elapsedMs: elapsed,
      estimatedRemainingMs: remaining,
    });

    // Yield to keep UI responsive (every 2 frames)
    if (frame % 2 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // ── Phase 4: Finalize ─────────────────────────────────────────────

  onProgress({
    phase: "encoding",
    currentFrame: totalFrames,
    totalFrames,
    percent: 100,
    elapsedMs: performance.now() - startTime,
    estimatedRemainingMs: 0,
  });

  recorder.stop();
  await recordingDone;

  disposeCompositor(compositor);
  if (audioCtx) void audioCtx.close();
  _cancelExport = null;

  const blob = new Blob(chunks, { type: mimeType });

  onProgress({
    phase: "complete",
    currentFrame: totalFrames,
    totalFrames,
    percent: 100,
    elapsedMs: performance.now() - startTime,
    estimatedRemainingMs: 0,
  });

  return blob;
}

/**
 * Cancel an in-progress export.
 */
let _cancelExport: (() => void) | null = null;

export function cancelExport(): void {
  if (_cancelExport) _cancelExport();
}

/**
 * Download a blob as a file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Audio mixing ────────────────────────────────────────────────────

/**
 * Mix all audio from timeline clips into a single AudioBuffer.
 * Decodes audio from each clip's media file and places it at the correct
 * timeline position, respecting in/out points and track muting.
 */
async function mixTimelineAudio(
  duration: number,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  const totalSamples = Math.ceil(duration * sampleRate);
  if (totalSamples <= 0) return null;

  // Collect all clips that have audio (audio tracks + video tracks with audio)
  const audioClips: {
    mediaId: string;
    startTime: number;
    inPoint: number;
    outPoint: number;
    duration: number;
  }[] = [];

  for (const track of projectState.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      audioClips.push({
        mediaId: clip.mediaId,
        startTime: clip.startTime,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        duration: clip.duration,
      });
    }
  }

  if (audioClips.length === 0) return null;

  // Create offline context for mixing
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Decode and schedule each clip
  for (const clip of audioClips) {
    const entry = mediaState.entries.find((e) => e.id === clip.mediaId);
    if (!entry) continue;

    try {
      const file = await entryFile(entry);
      if (!file) continue;
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0));

      // Create a source for this clip
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);

      // Schedule: start at clip.startTime, offset by inPoint, play for clip duration
      const offset = clip.inPoint;
      const clipDuration = Math.min(clip.duration, audioBuffer.duration - offset);
      if (clipDuration > 0) {
        source.start(clip.startTime, offset, clipDuration);
      }
    } catch {
      // Skip clips that can't be decoded (e.g. images)
      continue;
    }
  }

  try {
    return await offlineCtx.startRendering();
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function getMimeType(format: "webm" | "mp4"): string {
  if (format === "mp4") {
    // Try MP4 with H.264 first, fall back to WebM
    if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")) {
      return "video/mp4;codecs=avc1";
    }
    if (MediaRecorder.isTypeSupported("video/mp4")) {
      return "video/mp4";
    }
    // Fall back to WebM
    return "video/webm;codecs=vp9";
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) {
    return "video/webm;codecs=vp9,opus";
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9";
  }
  return "video/webm";
}

/**
 * Get supported export formats.
 */
export function getSupportedFormats(): {
  id: string;
  label: string;
  supported: boolean;
}[] {
  return [
    {
      id: "webm",
      label: "WebM (VP9)",
      supported: MediaRecorder.isTypeSupported("video/webm;codecs=vp9"),
    },
    {
      id: "webm-vp8",
      label: "WebM (VP8)",
      supported: MediaRecorder.isTypeSupported("video/webm;codecs=vp8"),
    },
    {
      id: "mp4",
      label: "MP4 (H.264)",
      supported:
        MediaRecorder.isTypeSupported("video/mp4;codecs=avc1") ||
        MediaRecorder.isTypeSupported("video/mp4"),
    },
  ];
}
