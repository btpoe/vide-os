/**
 * Live audio playback.
 *
 * A lookahead scheduler: every `TICK_MS` it schedules any clip starting within
 * the next `LOOKAHEAD_SEC`, at an absolute context time. Nothing is scheduled
 * per animation frame and nothing is corrected afterwards — a voice placed at
 * an absolute time simply happens then.
 *
 * This replaces calling `video.play()` on the source element and correcting
 * drift at a 0.15 s threshold, which meant audio and picture were two
 * independent playback systems being nudged toward each other.
 */

import type { ProjectDoc } from "@/model/doc";
import { framesToSeconds } from "@/lib/timecode";
import { getCachedAudio, loadAudio } from "./buffers";
import {
  buildVoice,
  createTrackNodes,
  trackGainValue,
  type MasterNodes,
  type TrackNodes,
  type Voice,
} from "./graph";

/** How often the scheduler runs. */
const TICK_MS = 100;
/** How far ahead of the playhead voices are scheduled. */
const LOOKAHEAD_SEC = 1.5;

export class AudioEngine {
  private readonly trackNodes = new Map<string, TrackNodes>();
  private readonly voices = new Map<string, Voice>();
  private master: MasterNodes | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Context time corresponding to timeline frame zero for this play segment. */
  private originTime = 0;
  private rate = 1;
  private doc: ProjectDoc | null = null;

  constructor(private readonly context: AudioContext) {}

  private ensureMaster(): MasterNodes {
    if (this.master) return this.master;
    const gain = this.context.createGain();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 256;
    gain.connect(analyser);
    analyser.connect(this.context.destination);
    this.master = { gain, analyser };
    return this.master;
  }

  private nodesForTrack(doc: ProjectDoc, trackId: string): TrackNodes | null {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) return null;

    let nodes = this.trackNodes.get(trackId);
    if (!nodes) {
      nodes = createTrackNodes(this.context, track, this.ensureMaster().gain, true);
      this.trackNodes.set(trackId, nodes);
    }
    nodes.gain.gain.value = trackGainValue(doc, track);
    return nodes;
  }

  /**
   * Starts playback from a timeline position.
   *
   * `originTime` is fixed once here, so every voice scheduled during this
   * segment is placed against the same reference.
   */
  start(doc: ProjectDoc, fromFrame: number, rate = 1): void {
    this.stop();
    this.doc = doc;
    this.rate = rate;

    const positionSec = framesToSeconds(fromFrame, doc.sequence.frameRate);
    this.originTime = this.context.currentTime - positionSec / rate;

    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stops everything and releases the voices. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const voice of this.voices.values()) voice.stop();
    this.voices.clear();
  }

  /** Re-reads the document. Call after an edit so the mix follows it. */
  update(doc: ProjectDoc): void {
    this.doc = doc;
    for (const [trackId, nodes] of this.trackNodes) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (track) nodes.gain.gain.value = trackGainValue(doc, track);
    }
  }

  private tick(): void {
    const doc = this.doc;
    if (!doc) return;

    const horizon = this.context.currentTime + LOOKAHEAD_SEC;

    for (const track of doc.tracks) {
      if (trackGainValue(doc, track) === 0) continue;

      for (const clip of track.clips) {
        if (this.voices.has(clip.id)) continue;
        if (clip.source.type !== "asset" || !clip.linkedAudio) continue;

        const startTime =
          this.originTime +
          framesToSeconds(clip.startFrame, doc.sequence.frameRate) / this.rate;
        const endTime =
          startTime +
          framesToSeconds(clip.durationFrames, doc.sequence.frameRate) / this.rate;

        // Not yet within the lookahead window, or already finished.
        if (startTime > horizon || endTime <= this.context.currentTime) continue;

        const buffer = this.bufferFor(clip.source.assetId, doc);
        if (!buffer) continue;

        const nodes = this.nodesForTrack(doc, track.id);
        if (!nodes) continue;

        const voice = buildVoice({
          context: this.context,
          doc,
          clip,
          buffer,
          destination: nodes.gain,
          timelineOriginTime: this.originTime,
          rate: this.rate,
        });
        if (!voice) continue;

        this.voices.set(clip.id, voice);
        voice.source.addEventListener("ended", () => this.voices.delete(clip.id));
      }
    }
  }

  /**
   * Decoded audio for an asset, kicking off a decode if it is not ready.
   *
   * Returns null on the first call for a file; the next tick picks it up. A
   * clip is therefore silent for at most one tick rather than blocking
   * playback while a file decodes.
   */
  private bufferFor(assetId: string, doc: ProjectDoc): AudioBuffer | null {
    const cached = getCachedAudio(assetId);
    if (cached) return cached;
    void loadAudio(assetId, doc.sequence.sampleRate);
    return null;
  }

  /** Peak levels per track and for the master, for the mixer meters. */
  levels(): { tracks: Map<string, number>; master: number } {
    const tracks = new Map<string, number>();
    for (const [trackId, nodes] of this.trackNodes) {
      if (nodes.analyser) tracks.set(trackId, peakOf(nodes.analyser));
    }
    return { tracks, master: this.master ? peakOf(this.master.analyser) : 0 };
  }

  setMasterGain(value: number): void {
    this.ensureMaster().gain.gain.value = Math.max(0, value);
  }

  dispose(): void {
    this.stop();
    for (const nodes of this.trackNodes.values()) {
      nodes.gain.disconnect();
      nodes.pan.disconnect();
      nodes.analyser?.disconnect();
    }
    this.trackNodes.clear();
    this.master?.gain.disconnect();
    this.master?.analyser.disconnect();
    this.master = null;
  }
}

/** Peak sample magnitude, 0..1. */
function peakOf(analyser: AnalyserNode): number {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let peak = 0;
  for (const sample of data) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}
