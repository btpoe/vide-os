/**
 * Deterministic export.
 *
 * The old engine drove `canvas.captureStream(0)` into a `MediaRecorder` and
 * called `requestFrame()` after each render. Frames therefore carried
 * **wall-clock** timestamps: a 60-second timeline that rendered at 8 fps came
 * out as roughly 225 seconds of slow motion. Audio was mixed offline and then
 * *played back in real time* into the same stream, so it could not line up.
 *
 * Nothing here has a clock in it. The loop is `for (frame = 0; frame < n)`,
 * every sample's timestamp is computed from its frame index, and the audio is
 * rendered once, up front, as a single buffer. Export takes as long as it
 * takes and the file is identical either way.
 *
 * The other half is that every frame is *awaited*. Preview skips a frame that
 * is not decoded yet, because waiting would stall the render loop; export
 * cannot, so it resolves each frame before compositing and hands them to the
 * pass through the same hook.
 */

import {
  Output,
  BufferTarget,
  StreamTarget,
  VideoSampleSource,
  AudioBufferSource,
  VideoSample,
  type Target,
} from "mediabunny";
import { contentEndFrame, type Clip, type ProjectDoc } from "@/model/doc";
import { safeFileStem } from "@/model/io";
import type { PositionedChunk } from "@/platform/types";
import { framesToSeconds, frameRateToNumber } from "@/lib/timecode";
import { buildScene } from "@/renderer/scene";
import {
  createCompositor,
  disposeCompositor,
  renderFrame,
  currentAccumulator,
  type Compositor,
  type FrameLookup,
} from "@/renderer/compositor";
import { waitForFonts } from "@/renderer/text-renderer";
import { MediaEngine, type BorrowedFrame } from "@/media/engine";
import { renderTimelineAudio } from "@/audio/offline";
import { negotiate } from "./encoder";
import { evenDimensions, type ExportSettings } from "./presets";

export interface ExportProgress {
  phase:
    | "preparing"
    | "audio"
    | "rendering"
    | "finalizing"
    | "complete"
    | "error"
    | "cancelled";
  frame: number;
  totalFrames: number;
  /** 0..1. */
  progress: number;
  elapsedMs: number;
  /** Null until enough frames have gone by to mean anything. */
  remainingMs: number | null;
  message?: string;
}

export type ProgressCallback = (progress: ExportProgress) => void;

export interface ExportResult {
  blob: Blob | null;
  /** Named from what was encoded, never from what was asked for. */
  filename: string;
  frames: number;
  durationSec: number;
  codecs: { video: string; audio: string | null };
}

export interface ExportOptions {
  settings: ExportSettings;
  doc: ProjectDoc;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  /**
   * Where to write. Omit to build a `Blob` in memory, which is fine for short
   * exports and is what the download path uses; pass a writable to stream to
   * disk, which a 4K feature-length export needs because it will not fit in a
   * `Blob`.
   *
   * The chunks are *positioned* writes, not an append-only stream: MP4 patches
   * its header once the sizes are known, so the target has to be able to seek.
   * `FileSystemWritableFileStream` accepts exactly this shape.
   */
  writable?: WritableStream<PositionedChunk>;
}

export class ExportError extends Error {
  constructor(
    message: string,
    /** What the user can do about it. */
    readonly remedy?: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

/**
 * The timestamp of a frame, in seconds.
 *
 * Exact rational arithmetic on the sequence's frame rate: frame 1798 of a
 * 30000/1001 sequence is 1798 × 1001 / 30000 exactly, not 1798 × 0.0333…
 * accumulated. A double holds that to within a femtosecond over any timeline
 * anyone will build, so the microsecond value the muxer stores is exact.
 */
export function frameTimestamp(
  frame: number,
  rate: { num: number; den: number },
): number {
  return (frame * rate.den) / rate.num;
}

/** Total frames in the export: the content's length, not a padded duration. */
export function exportFrameCount(doc: ProjectDoc): number {
  return contentEndFrame(doc);
}

function progressOf(
  phase: ExportProgress["phase"],
  frame: number,
  totalFrames: number,
  startedAt: number,
  message?: string,
): ExportProgress {
  const elapsedMs = performance.now() - startedAt;
  const progress = totalFrames > 0 ? frame / totalFrames : 0;
  // An estimate from two frames is noise; from twenty it is useful.
  const remainingMs =
    frame >= 20 && progress > 0 ? (elapsedMs / progress) * (1 - progress) : null;
  return { phase, frame, totalFrames, progress, elapsedMs, remainingMs, message };
}

/**
 * Resolves every frame a scene needs, waiting for each one.
 *
 * Ownership transfers to the returned lookup: whatever the render pass takes,
 * the pass releases. Whatever it does not take is released by the caller, so a
 * layer that ends up skipped cannot pin a frame in the cache.
 */
async function resolveSceneFrames(
  engine: MediaEngine,
  doc: ProjectDoc,
  frame: number,
): Promise<{ lookup: FrameLookup; releaseRest: () => void }> {
  const scene = buildScene(doc, frame);
  const held = new Map<string, BorrowedFrame>();

  for (const request of scene.requests) {
    if (held.has(request.clipId)) continue;
    const clip = findClip(doc, request.clipId);
    if (!clip) continue;
    const borrowed = await engine.getExact(doc, clip, frame);
    if (borrowed) held.set(request.clipId, borrowed);
  }

  const lookup: FrameLookup = (_doc, clip) => {
    const borrowed = held.get(clip.id);
    if (!borrowed) return null;
    held.delete(clip.id);
    return borrowed;
  };

  return {
    lookup,
    releaseRest: () => {
      for (const borrowed of held.values()) borrowed.release();
      held.clear();
    },
  };
}

function findClip(doc: ProjectDoc, clipId: string): Clip | undefined {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

/**
 * Reads the finished composite as a frame the encoder can take.
 *
 * Off the composite framebuffer rather than the canvas: the drawing buffer is
 * created with `preserveDrawingBuffer: false` and is cleared the moment the
 * browser composites, so reading it from a later task returns black.
 *
 * GL reads bottom-up and video is top-down, so the rows are flipped back here.
 */
function readComposite(
  comp: Compositor,
  width: number,
  height: number,
  timestamp: number,
  duration: number,
): VideoSample {
  const { gl } = comp;
  gl.bindFramebuffer(gl.FRAMEBUFFER, currentAccumulator(comp).fbo);

  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const flipped = new Uint8Array(pixels.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * rowBytes;
    flipped.set(pixels.subarray(from, from + rowBytes), y * rowBytes);
  }

  return new VideoSample(flipped, {
    format: "RGBX",
    codedWidth: width,
    codedHeight: height,
    timestamp,
    duration,
  });
}

/**
 * Renders and muxes the whole timeline.
 *
 * Throws `ExportError` with something actionable rather than returning a null
 * the caller has to interpret.
 */
export async function exportTimeline(options: ExportOptions): Promise<ExportResult> {
  const { settings, doc, onProgress, signal } = options;
  const startedAt = performance.now();
  const report = (
    phase: ExportProgress["phase"],
    frame: number,
    total: number,
    message?: string,
  ) => onProgress?.(progressOf(phase, frame, total, startedAt, message));

  const rate = doc.sequence.frameRate;
  const totalFrames = exportFrameCount(doc);
  if (totalFrames <= 0) {
    throw new ExportError(
      "There is nothing on the timeline to export.",
      "Add a clip first.",
    );
  }

  report("preparing", 0, totalFrames, "Checking codecs");

  const choice = await negotiate(settings);
  if (!choice) {
    throw new ExportError(
      `This browser cannot encode ${settings.container.toUpperCase()} at ${settings.width}×${settings.height}.`,
      "Try WebM, or a smaller frame size.",
    );
  }

  // Rendering a title before its font loads bakes the fallback typeface into
  // the file while the preview shows the right one.
  await waitForFonts();

  const { width, height } = evenDimensions(settings);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  // At the export size, not the preview size. The 4K preset used to render
  // 1080p and upscale, because the compositor was built from the sequence.
  const comp = createCompositorAt(canvas, width, height);
  if (!comp) {
    throw new ExportError(
      "Could not create a WebGL2 context for export.",
      "Close other tabs using the GPU and try again.",
    );
  }

  // Its own decoders, so a long export cannot evict the frames the editor is
  // showing, and so everything it opened is closed when it finishes. Assets
  // themselves are registered globally, so nothing needs re-opening.
  const engine = new MediaEngine(EXPORT_DECODER_BUDGET);

  const target: Target = options.writable
    ? new StreamTarget(options.writable)
    : new BufferTarget();
  const output = new Output({ format: choice.format, target });

  const videoSource = new VideoSampleSource({
    codec: choice.video,
    bitrate: settings.videoBitrate,
    // A key frame every two seconds keeps seeking usable without costing much.
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: frameRateToNumber(rate) });

  let audioBuffer: AudioBuffer | null = null;
  let audioSource: AudioBufferSource | null = null;

  try {
    if (settings.includeAudio && choice.audio) {
      report("audio", 0, totalFrames, "Mixing audio");
      // Once, up front, as one buffer. The old engine played the mix into the
      // recorder in real time, which is why it could never stay in sync.
      audioBuffer = await renderTimelineAudio(doc, {
        durationSec: framesToSeconds(totalFrames, rate),
      });
      if (audioBuffer) {
        audioSource = new AudioBufferSource({
          codec: choice.audio,
          bitrate: settings.audioBitrate,
        });
        output.addAudioTrack(audioSource);
      }
    }

    throwIfAborted(signal);
    await output.start();

    if (audioSource && audioBuffer) await audioSource.add(audioBuffer);

    const frameDuration = frameTimestamp(1, rate);

    for (let frame = 0; frame < totalFrames; frame++) {
      throwIfAborted(signal);

      const { lookup, releaseRest } = await resolveSceneFrames(engine, doc, frame);
      try {
        renderFrame(comp, frame, lookup, doc);
      } finally {
        releaseRest();
      }

      const sample = readComposite(
        comp,
        width,
        height,
        frameTimestamp(frame, rate),
        frameDuration,
      );
      try {
        // Awaited, so encoder and writer backpressure is respected rather
        // than queueing the whole timeline into memory.
        await videoSource.add(sample);
      } finally {
        sample.close();
      }

      if (frame % 5 === 0 || frame === totalFrames - 1) {
        report("rendering", frame + 1, totalFrames);
      }
    }

    report("finalizing", totalFrames, totalFrames, "Writing the file");
    await output.finalize();

    const blob =
      target instanceof BufferTarget && target.buffer
        ? new Blob([target.buffer], { type: choice.mimeType })
        : null;

    report("complete", totalFrames, totalFrames);

    return {
      blob,
      filename: `${safeFileStem(doc.name, "export")}.${choice.extension}`,
      frames: totalFrames,
      durationSec: framesToSeconds(totalFrames, rate),
      codecs: { video: choice.video, audio: audioSource ? choice.audio : null },
    };
  } catch (error) {
    // Leaving a half-written file behind is worse than none.
    await output.cancel().catch(() => undefined);
    if (isAbort(error)) {
      report("cancelled", 0, totalFrames);
      throw new ExportError("Export cancelled.");
    }
    report("error", 0, totalFrames, String(error));
    throw error;
  } finally {
    engine.dispose();
    disposeCompositor(comp);
  }
}

/**
 * Decoders the export may hold open at once.
 *
 * Smaller than the preview's, because export is throughput-bound rather than
 * latency-bound: it awaits every frame anyway, so a decoder it has to
 * re-acquire costs a seek, not a dropped frame.
 */
const EXPORT_DECODER_BUDGET = 3;

/**
 * A compositor sized for export rather than for the sequence.
 *
 * `createCompositor` reads the sequence's dimensions, which is right for the
 * preview and wrong here — it is why the 4K preset produced a 1080p picture in
 * a 4K file.
 */
function createCompositorAt(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Compositor | null {
  return createCompositor(canvas, { width, height });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Hands a finished blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next task so the click has taken effect first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
