/**
 * Media probing: what is actually in a file, and can this browser play it.
 *
 * This replaces guessing from the filename. The old code kept a list of
 * extensions it called "supported" — including `.avi`, `.mkv`, `.flv`, `.wmv`
 * and `.heic`, none of which a browser decodes — handed the file to a `<video>`
 * element, and swallowed the failure. The clip imported with a nice icon and a
 * duration, then rendered black forever with nothing said.
 *
 * Here the container is demuxed and each track asked `canDecode()`, so the
 * answer is about this file in this browser rather than about its name. When
 * the answer is no, the reason is specific enough to act on.
 */

import {
  ALL_FORMATS,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from "mediabunny";
import type { AssetProblem } from "@/model/doc";
import type { FrameRate } from "@/lib/timecode";
import { frameRateFromNumber } from "@/lib/timecode";

export interface TrackInfo {
  codec: string | null;
  decodable: boolean;
}

export interface VideoTrackInfo extends TrackInfo {
  width: number;
  height: number;
  frameRate?: FrameRate;
  rotation: number;
}

export interface AudioTrackInfo extends TrackInfo {
  channels: number;
  sampleRate: number;
}

export interface ProbeResult {
  durationSec: number;
  video: VideoTrackInfo | null;
  audio: AudioTrackInfo | null;
  mimeType: string;
  /** Set when the file cannot be used as-is. */
  problem?: AssetProblem;
}

async function describeVideo(track: InputVideoTrack): Promise<VideoTrackInfo> {
  const [codec, decodable, packetStats] = await Promise.all([
    track.getCodec(),
    track.canDecode(),
    // Sampling a few hundred packets is enough for an average frame rate and
    // avoids walking a long file just to label it.
    track.computePacketStats(200).catch(() => null),
  ]);

  return {
    codec,
    decodable,
    width: track.displayWidth,
    height: track.displayHeight,
    frameRate: packetStats?.averagePacketRate
      ? frameRateFromNumber(packetStats.averagePacketRate)
      : undefined,
    rotation: track.rotation,
  };
}

async function describeAudio(track: InputAudioTrack): Promise<AudioTrackInfo> {
  const [codec, decodable] = await Promise.all([track.getCodec(), track.canDecode()]);
  return {
    codec,
    decodable,
    channels: track.numberOfChannels,
    sampleRate: track.sampleRate,
  };
}

function describeProblem(
  video: VideoTrackInfo | null,
  audio: AudioTrackInfo | null,
): AssetProblem | undefined {
  if (!video && !audio) {
    return {
      kind: "unsupported-codec",
      detail: "No video or audio track could be found in this file.",
    };
  }

  const undecodable: string[] = [];
  if (video && !video.decodable) undecodable.push(video.codec ?? "unknown video codec");
  if (audio && !audio.decodable) undecodable.push(audio.codec ?? "unknown audio codec");
  if (undecodable.length === 0) return undefined;

  // If *something* decodes the file is still partly usable, so say which part
  // is missing rather than refusing the whole thing.
  const usable = (video?.decodable ?? false) || (audio?.decodable ?? false);
  return {
    kind: "unsupported-codec",
    detail: usable
      ? `This browser cannot decode ${undecodable.join(" or ")}; that part will be silent or blank.`
      : `This browser cannot decode ${undecodable.join(" or ")}. Convert the file to H.264 in MP4, or VP9 in WebM.`,
  };
}

/**
 * Reads a file's structure and reports what can be done with it.
 *
 * Never throws for a bad file: an unreadable or unrecognised container comes
 * back as a `ProbeResult` carrying a problem, because the caller needs to show
 * the user something either way.
 */
export async function probeMedia(input: Input): Promise<ProbeResult> {
  try {
    if (!(await input.canRead())) {
      return {
        durationSec: 0,
        video: null,
        audio: null,
        mimeType: "",
        problem: {
          kind: "decode-failed",
          detail: "This file is not a media container this app understands.",
        },
      };
    }

    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);

    const [video, audio, durationSec, mimeType] = await Promise.all([
      videoTrack ? describeVideo(videoTrack) : null,
      audioTrack ? describeAudio(audioTrack) : null,
      input.computeDuration().catch(() => 0),
      input.getMimeType().catch(() => ""),
    ]);

    return {
      durationSec,
      video,
      audio,
      mimeType,
      problem: describeProblem(video, audio),
    };
  } catch (error) {
    return {
      durationSec: 0,
      video: null,
      audio: null,
      mimeType: "",
      problem: {
        kind: "decode-failed",
        detail:
          error instanceof Error
            ? `Could not read this file: ${error.message}`
            : "Could not read this file.",
      },
    };
  }
}

/** Opens a source for probing or decoding. Accepts every container Mediabunny knows. */
export function openInput(
  source: ConstructorParameters<typeof Input>[0]["source"],
): Input {
  return new Input({ source, formats: ALL_FORMATS });
}
