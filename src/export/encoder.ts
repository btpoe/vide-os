/**
 * What this browser can actually encode.
 *
 * The old dialog listed formats from a `MediaRecorder.isTypeSupported` guess
 * and then fell back to WebM without telling anyone, so "MP4" could produce a
 * WebM file with an `.mp4` name and no audio track. Here the question is asked
 * properly — `VideoEncoder.isConfigSupported` via Mediabunny, at the exact
 * resolution and bitrate being requested — and a container with no usable
 * codec is reported as unavailable rather than quietly substituted.
 *
 * Support is per *combination*: H.264 in MP4 is near-universal, VP9 in MP4 is
 * not, and a codec that encodes at 1080p may fail at 4K on the same machine.
 * So probing takes the settings, not just the container.
 */

import {
  Mp4OutputFormat,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec,
  type AudioCodec,
  type OutputFormat,
  type VideoCodec,
} from "mediabunny";
import type { Container, ExportSettings } from "./presets";
import { evenDimensions } from "./presets";

export interface CodecChoice {
  container: Container;
  format: OutputFormat;
  video: VideoCodec;
  /** Null when the browser can encode no audio codec this container accepts. */
  audio: AudioCodec | null;
  /** The extension matching what will actually be written. */
  extension: string;
  mimeType: string;
}

/**
 * Preference order within each container.
 *
 * H.264 first for MP4 because it plays everywhere, including in the hardware
 * decoders of phones and TVs. VP9 first for WebM for the same reason within
 * that ecosystem, with VP8 as the old-browser fallback.
 */
const VIDEO_PREFERENCE: Record<Container, VideoCodec[]> = {
  mp4: ["avc", "hevc", "av1", "vp9"],
  webm: ["vp9", "av1", "vp8"],
};

const AUDIO_PREFERENCE: Record<Container, AudioCodec[]> = {
  mp4: ["aac", "opus"],
  webm: ["opus", "vorbis"],
};

function formatFor(container: Container): OutputFormat {
  return container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
}

/**
 * Picks the codecs for one container, or null if the browser can encode none
 * of the ones it accepts.
 */
export async function negotiate(
  settings: ExportSettings,
  container: Container = settings.container,
): Promise<CodecChoice | null> {
  const format = formatFor(container);
  const { width, height } = evenDimensions(settings);

  // Intersect what the container accepts with what this browser can encode,
  // at the size actually being exported.
  const videoCandidates = VIDEO_PREFERENCE[container].filter((codec) =>
    format.getSupportedVideoCodecs().includes(codec),
  );
  const video = await getFirstEncodableVideoCodec(videoCandidates, {
    width,
    height,
    quality: undefined,
    bitrate: settings.videoBitrate,
  });
  if (!video) return null;

  let audio: AudioCodec | null = null;
  if (settings.includeAudio) {
    const audioCandidates = AUDIO_PREFERENCE[container].filter((codec) =>
      format.getSupportedAudioCodecs().includes(codec),
    );
    audio = await getFirstEncodableAudioCodec(audioCandidates, {
      numberOfChannels: 2,
      sampleRate: 48_000,
      bitrate: settings.audioBitrate,
    });
  }

  return {
    container,
    format,
    video,
    audio,
    extension: container === "mp4" ? "mp4" : "webm",
    mimeType: format.mimeType,
  };
}

export interface ContainerAvailability {
  container: Container;
  label: string;
  available: boolean;
  video: VideoCodec | null;
  audio: AudioCodec | null;
  /** Why it cannot be used, in the user's terms. */
  reason?: string;
}

/**
 * Both containers, probed, for the dialog to present.
 *
 * Presenting a container that cannot be produced is what led to files that did
 * not match their names.
 */
export async function availableContainers(
  settings: ExportSettings,
): Promise<ContainerAvailability[]> {
  const containers: { id: Container; label: string }[] = [
    { id: "mp4", label: "MP4" },
    { id: "webm", label: "WebM" },
  ];

  return Promise.all(
    containers.map(async ({ id, label }) => {
      const choice = await negotiate(settings, id);
      if (!choice) {
        return {
          container: id,
          label,
          available: false,
          video: null,
          audio: null,
          reason: `This browser cannot encode video for ${label} at ${settings.width}×${settings.height}.`,
        };
      }
      return {
        container: id,
        label,
        available: true,
        video: choice.video,
        audio: choice.audio,
        reason:
          settings.includeAudio && !choice.audio
            ? "No audio codec available; the file will have no sound."
            : undefined,
      };
    }),
  );
}

/** Human-readable codec names, for the dialog's summary line. */
export function codecLabel(codec: VideoCodec | AudioCodec | null): string {
  if (!codec) return "none";
  const names: Record<string, string> = {
    avc: "H.264",
    hevc: "H.265",
    av1: "AV1",
    vp9: "VP9",
    vp8: "VP8",
    aac: "AAC",
    opus: "Opus",
    vorbis: "Vorbis",
  };
  return names[codec] ?? codec.toUpperCase();
}
