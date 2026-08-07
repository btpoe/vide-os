/**
 * Rendering the timeline's audio to a buffer, for export.
 *
 * Uses `buildVoice` — the *same* function live playback uses — against an
 * `OfflineAudioContext`. That is the whole design: preview and export share one
 * code path, so what you hear cannot differ from what you get.
 *
 * Two bugs this replaces:
 *
 * - The old mixdown iterated **every** track with no kind filter, while
 *   `addClipToTrack` auto-created a duplicate audio clip for each video clip.
 *   Every clip's audio was therefore mixed twice, at double amplitude, clipping.
 *   Both halves of that are gone: there is no phantom clip, and a video clip
 *   contributes audio through its own `linkedAudio` flag exactly once.
 * - It re-decoded the whole source file once per clip. Twenty clips cut from
 *   one recording meant twenty full decodes into memory. Decoding is cached per
 *   asset now.
 */

import type { ProjectDoc } from "@/model/doc";
import { contentEndFrame } from "@/model/doc";
import { framesToSeconds } from "@/lib/timecode";
import { loadAudio } from "./buffers";
import { buildVoice, createTrackNodes, trackGainValue } from "./graph";

export interface OfflineRenderOptions {
  /** Defaults to the sequence's rate. */
  sampleRate?: number;
  channels?: number;
  /** Defaults to the end of the content. */
  durationSec?: number;
}

/**
 * Renders the whole timeline's audio.
 *
 * Returns null when there is nothing to render, so callers can produce a
 * video-only file rather than an empty silent track.
 */
export async function renderTimelineAudio(
  doc: ProjectDoc,
  options: OfflineRenderOptions = {},
): Promise<AudioBuffer | null> {
  const sampleRate = options.sampleRate ?? doc.sequence.sampleRate;
  const channels = options.channels ?? 2;
  const durationSec =
    options.durationSec ??
    framesToSeconds(contentEndFrame(doc), doc.sequence.frameRate);

  if (durationSec <= 0) return null;

  // Decode everything the timeline references first. Doing it up front means
  // the offline render itself never has to wait, so it runs at whatever speed
  // the CPU allows rather than in real time.
  const assetIds = new Set<string>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.source.type === "asset" && clip.linkedAudio && clip.enabled) {
        assetIds.add(clip.source.assetId);
      }
    }
  }
  const decoded = new Map<string, AudioBuffer>();
  await Promise.all(
    [...assetIds].map(async (id) => {
      const buffer = await loadAudio(id, sampleRate);
      if (buffer) decoded.set(id, buffer);
    }),
  );
  if (decoded.size === 0) return null;

  const length = Math.max(1, Math.ceil(durationSec * sampleRate));
  const context = new OfflineAudioContext(channels, length, sampleRate);

  let scheduled = 0;
  for (const track of doc.tracks) {
    if (trackGainValue(doc, track) === 0) continue;

    const nodes = createTrackNodes(context, track, context.destination, false);
    nodes.gain.gain.value = trackGainValue(doc, track);

    for (const clip of track.clips) {
      if (clip.source.type !== "asset") continue;
      const buffer = decoded.get(clip.source.assetId);
      if (!buffer) continue;

      const voice = buildVoice({
        context,
        doc,
        clip,
        buffer,
        destination: nodes.gain,
        // Offline: the context starts at zero, so timeline zero is context
        // zero. Live playback passes a different origin; nothing else differs.
        timelineOriginTime: 0,
      });
      if (voice) scheduled++;
    }
  }

  if (scheduled === 0) return null;
  return context.startRendering();
}
