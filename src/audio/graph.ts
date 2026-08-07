/**
 * Building the audio graph for a clip.
 *
 * `buildVoice` takes the context as a parameter, which is the entire point:
 * live preview passes an `AudioContext` and export passes an
 * `OfflineAudioContext`, and they run *the same code*. Preview and export
 * therefore cannot disagree about what the mix sounds like.
 *
 * The old export mixed audio through a completely separate code path, and then
 * played that mix into a MediaRecorder in real time while video rendered at
 * render speed — so it could not line up even in principle.
 *
 * All automation is scheduled at **absolute context times**. There is no
 * per-frame "sync the audio" step anywhere in this codebase, because there does
 * not need to be one: a ramp scheduled at an absolute time happens at that
 * time.
 */

import type { Clip, ProjectDoc, Track } from "@/model/doc";
import { evaluate } from "@/lib/animation";
import { framesToSeconds } from "@/lib/timecode";

/** Where a clip's audio is routed. Created once per track. */
export interface TrackNodes {
  gain: GainNode;
  pan: StereoPannerNode;
  analyser?: AnalyserNode;
}

export interface MasterNodes {
  gain: GainNode;
  analyser: AnalyserNode;
}

export interface VoiceOptions {
  context: BaseAudioContext;
  doc: ProjectDoc;
  clip: Clip;
  buffer: AudioBuffer;
  destination: AudioNode;
  /**
   * Context time corresponding to timeline frame zero.
   *
   * Live playback passes `contextTime - timelinePosition`; offline passes 0.
   * Every absolute time below is derived from it, which is what keeps the two
   * identical.
   */
  timelineOriginTime: number;
  /** Playback rate multiplier applied on top of the clip's own speed. */
  rate?: number;
}

export interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  clipId: string;
  /** Context time the voice is scheduled to start. */
  startTime: number;
  /** Context time it is scheduled to stop. */
  stopTime: number;
  stop: () => void;
}

/**
 * Writes a clip's volume automation onto a gain node as absolute-time ramps.
 *
 * Keyframes become a ramp per segment; fades are applied on top at the clip's
 * own edges. A clip with neither gets a single `setValueAtTime`, which is both
 * correct and free.
 */
function scheduleGain(
  gain: GainNode,
  clip: Clip,
  doc: ProjectDoc,
  clipStartTime: number,
  clipDurationSec: number,
  rate: number,
): void {
  const frameRate = doc.sequence.frameRate;
  const param = gain.gain;
  param.cancelScheduledValues(clipStartTime);

  const keys = clip.volume.keys;
  if (!keys?.length) {
    param.setValueAtTime(clip.volume.value, clipStartTime);
  } else {
    // Keyframe times are frames from the clip's start; a clip playing at 2x
    // reaches its keyframes in half the wall-clock time.
    for (const key of keys) {
      const at = clipStartTime + framesToSeconds(key.timeFrames, frameRate) / rate;
      const value = typeof key.value === "number" ? key.value : 1;
      if (key.interp === "hold") param.setValueAtTime(value, at);
      else param.linearRampToValueAtTime(value, Math.max(clipStartTime, at));
    }
    // Anchor the start so the first ramp has something to ramp from.
    param.setValueAtTime(evaluate(clip.volume, 0), clipStartTime);
  }

  const fadeInSec = framesToSeconds(clip.fadeInFrames, frameRate) / rate;
  const fadeOutSec = framesToSeconds(clip.fadeOutFrames, frameRate) / rate;

  if (fadeInSec > 0) {
    param.setValueAtTime(0, clipStartTime);
    param.linearRampToValueAtTime(
      evaluate(clip.volume, clip.fadeInFrames),
      clipStartTime + fadeInSec,
    );
  }
  if (fadeOutSec > 0) {
    const fadeStart = clipStartTime + clipDurationSec - fadeOutSec;
    param.setValueAtTime(
      evaluate(clip.volume, clip.durationFrames - clip.fadeOutFrames),
      Math.max(clipStartTime, fadeStart),
    );
    param.linearRampToValueAtTime(0, clipStartTime + clipDurationSec);
  }
}

/**
 * Creates and schedules one clip's audio.
 *
 * Returns null when the clip contributes nothing — a video clip with its audio
 * detached, or one whose scheduled window has already passed.
 */
export function buildVoice(options: VoiceOptions): Voice | null {
  const { context, doc, clip, buffer, destination, timelineOriginTime } = options;
  const rate = options.rate ?? 1;
  const frameRate = doc.sequence.frameRate;

  if (!clip.enabled) return null;
  if (clip.source.type !== "asset") return null;
  if (!clip.linkedAudio) return null;

  const clipStartSec = framesToSeconds(clip.startFrame, frameRate);
  const clipDurationSec = framesToSeconds(clip.durationFrames, frameRate) / rate;
  const inPointSec = framesToSeconds(clip.inPointFrames, frameRate);

  const startTime = timelineOriginTime + clipStartSec / rate;
  const stopTime = startTime + clipDurationSec;

  // Already finished relative to the context's clock.
  if (stopTime <= context.currentTime) return null;

  const source = context.createBufferSource();
  source.buffer = buffer;
  // The clip's own speed and the transport rate compose.
  source.playbackRate.value = clip.speed * rate;

  const gain = context.createGain();
  const pan = context.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, evaluate(clip.pan, 0)));

  source.connect(gain);
  gain.connect(pan);
  pan.connect(destination);

  scheduleGain(gain, clip, doc, startTime, clipDurationSec, rate);

  // Starting in the past would throw; begin partway in instead, which is what
  // playing from the middle of a clip means.
  const now = context.currentTime;
  const lateBy = Math.max(0, now - startTime);
  const offset = inPointSec + lateBy * clip.speed * rate;
  const remaining = clipDurationSec - lateBy;
  if (remaining <= 0) return null;

  source.start(Math.max(now, startTime), offset, remaining * clip.speed * rate);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      source.stop();
    } catch {
      // Already stopped, or never started.
    }
    source.disconnect();
    gain.disconnect();
    pan.disconnect();
  };
  source.onended = () => stop();

  return { source, gain, pan, clipId: clip.id, startTime, stopTime, stop };
}

/** Creates the per-track gain/pan pair, with an optional meter tap. */
export function createTrackNodes(
  context: BaseAudioContext,
  track: Track,
  destination: AudioNode,
  withAnalyser: boolean,
): TrackNodes {
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  gain.connect(pan);

  let analyser: AnalyserNode | undefined;
  if (withAnalyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    pan.connect(analyser);
    analyser.connect(destination);
  } else {
    pan.connect(destination);
  }

  return { gain, pan, analyser };
}

/**
 * Effective gain for a track, accounting for solo.
 *
 * Any soloed track silences every track that is not soloed — the usual
 * convention, and the reason solo cannot simply be "not muted".
 */
export function trackGainValue(doc: ProjectDoc, track: Track): number {
  const anySolo = doc.tracks.some((t) => t.soloed);
  if (track.muted) return 0;
  if (anySolo && !track.soloed) return 0;
  return 1;
}
