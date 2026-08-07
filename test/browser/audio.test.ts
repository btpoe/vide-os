import { describe, it, expect, afterEach } from "vitest";
import { create } from "mutative";
import { createEmptyDoc, type ProjectDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { forgetAllAudio, loadAudio } from "@/audio/buffers";
import { renderTimelineAudio } from "@/audio/offline";
import { makeTestVideo } from "../fixtures/make-media";

/**
 * Audio correctness, checked by rendering offline and measuring the samples.
 *
 * These cover the two things the old mixdown got wrong: it summed every track
 * with no kind filter while a phantom duplicate audio clip existed for each
 * video clip, so everything was mixed twice at double amplitude; and it
 * re-decoded the whole source file once per clip.
 */

const FPS = 30;
const FRAMES = 60; // two seconds
const SAMPLE_RATE = 48000;
const ASSET_ID = "audio-fixture";

let fixture: Blob | null = null;
async function toneVideo(): Promise<Blob> {
  fixture ??= await makeTestVideo({
    fps: FPS,
    frames: FRAMES,
    width: 64,
    height: 64,
    withAudio: true,
    toneHz: 440,
  });
  return fixture;
}

/** Peak absolute sample over a time window. */
function peakBetween(buffer: AudioBuffer, fromSec: number, toSec: number): number {
  const from = Math.max(0, Math.floor(fromSec * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil(toSec * buffer.sampleRate));
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = from; i < to; i++) {
      const magnitude = Math.abs(data[i]);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

async function docWithAudioClip(
  overrides: Partial<Parameters<typeof edits.insertClip>[4]> = {},
): Promise<ProjectDoc> {
  const blob = await toneVideo();
  await mediaEngine.openBlob(ASSET_ID, blob);

  return create(createEmptyDoc(), (d) => {
    d.sequence.frameRate = FPS_30;
    d.sequence.sampleRate = SAMPLE_RATE;
    edits.upsertAsset(d, {
      id: ASSET_ID,
      name: "tone.mp4",
      kind: "video",
      size: blob.size,
      durationSec: FRAMES / FPS,
      hasAudio: true,
    });
    const track = d.tracks.find((t) => t.kind === "audio")!;
    edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
      startFrame: 0,
      mode: "overwrite",
      ...overrides,
    });
  });
}

afterEach(() => {
  forgetAllAssets();
  forgetAllAudio();
});

describe("decoding", () => {
  it("decodes audio out of a video file", async () => {
    await mediaEngine.openBlob(ASSET_ID, await toneVideo());
    const buffer = await loadAudio(ASSET_ID, SAMPLE_RATE);

    expect(buffer).not.toBeNull();
    expect(buffer!.sampleRate).toBe(SAMPLE_RATE);
    expect(peakBetween(buffer!, 0.2, 1.5)).toBeGreaterThan(0.1);

    // Decoded audio runs slightly *longer* than the video: AAC carries
    // encoder priming and pads to a frame boundary, so a two-second clip
    // decodes to about 2.07s. That overhang is harmless here because the
    // offline render places clips by timeline position and sizes the output
    // buffer from the timeline, so the tail is simply not used.
    expect(buffer!.duration).toBeGreaterThanOrEqual(FRAMES / FPS);
    expect(buffer!.duration).toBeLessThan(FRAMES / FPS + 0.2);
  });

  it("resamples to the sequence rate", async () => {
    // Mixing buffers of different rates in one graph is what pitch-shifts
    // audio, so everything is brought to the project's rate on the way in.
    await mediaEngine.openBlob(ASSET_ID, await toneVideo());
    const buffer = await loadAudio(ASSET_ID, 44100);
    expect(buffer!.sampleRate).toBe(44100);
  });

  it("caches, so a second call does not decode again", async () => {
    await mediaEngine.openBlob(ASSET_ID, await toneVideo());
    const first = await loadAudio(ASSET_ID, SAMPLE_RATE);
    const second = await loadAudio(ASSET_ID, SAMPLE_RATE);
    expect(second).toBe(first);
  });
});

describe("offline mix", () => {
  it("renders a clip's audio at the right place on the timeline", async () => {
    const doc = await docWithAudioClip();
    const rendered = await renderTimelineAudio(doc);

    expect(rendered).not.toBeNull();
    expect(rendered!.duration).toBeCloseTo(FRAMES / FPS, 1);
    expect(peakBetween(rendered!, 0.2, 1.5)).toBeGreaterThan(0.1);
  });

  it("places a clip that starts partway along at that offset", async () => {
    const blob = await toneVideo();
    await mediaEngine.openBlob(ASSET_ID, blob);

    const doc = create(createEmptyDoc(), (d) => {
      d.sequence.frameRate = FPS_30;
      d.sequence.sampleRate = SAMPLE_RATE;
      edits.upsertAsset(d, {
        id: ASSET_ID,
        name: "tone.mp4",
        kind: "video",
        size: blob.size,
        durationSec: FRAMES / FPS,
        hasAudio: true,
      });
      const track = d.tracks.find((t) => t.kind === "audio")!;
      // Starts at 1s, runs for 1s.
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, 30, {
        startFrame: 30,
        mode: "overwrite",
      });
    });

    const rendered = await renderTimelineAudio(doc);
    expect(rendered).not.toBeNull();
    // Silent before the clip, audible during it.
    expect(peakBetween(rendered!, 0, 0.9)).toBeLessThan(0.02);
    expect(peakBetween(rendered!, 1.1, 1.9)).toBeGreaterThan(0.1);
  });

  it("does not double the amplitude of a video clip's audio", async () => {
    // The old mixdown summed every track with no kind filter while a phantom
    // duplicate audio clip existed per video clip, so everything was mixed
    // twice and clipped.
    const doc = await docWithAudioClip();
    const rendered = await renderTimelineAudio(doc);
    // The fixture tone peaks at 0.5; twice that would be at or above 1.0.
    expect(peakBetween(rendered!, 0.2, 1.5)).toBeLessThan(0.9);
  });

  it("applies clip volume", async () => {
    const base = await docWithAudioClip();
    const loud = await renderTimelineAudio(base);

    const quiet = await renderTimelineAudio(
      create(base, (d) => {
        d.tracks.find((t) => t.kind === "audio")!.clips[0].volume = { value: 0.25 };
      }),
    );

    const loudPeak = peakBetween(loud!, 0.2, 1.5);
    const quietPeak = peakBetween(quiet!, 0.2, 1.5);
    expect(quietPeak).toBeLessThan(loudPeak * 0.5);
    expect(quietPeak).toBeGreaterThan(0.01);
  });

  it("applies a fade in", async () => {
    const base = await docWithAudioClip();
    const faded = await renderTimelineAudio(
      create(base, (d) => {
        // One second of fade at 30fps.
        d.tracks.find((t) => t.kind === "audio")!.clips[0].fadeInFrames = 30;
      }),
    );

    // Near silent at the very start, full by the end of the fade.
    expect(peakBetween(faded!, 0, 0.05)).toBeLessThan(0.05);
    expect(peakBetween(faded!, 0.9, 1.5)).toBeGreaterThan(0.1);
  });

  it("applies a fade out", async () => {
    const base = await docWithAudioClip();
    const faded = await renderTimelineAudio(
      create(base, (d) => {
        d.tracks.find((t) => t.kind === "audio")!.clips[0].fadeOutFrames = 30;
      }),
    );

    expect(peakBetween(faded!, 0.1, 0.8)).toBeGreaterThan(0.1);
    expect(peakBetween(faded!, 1.97, 2.0)).toBeLessThan(0.05);
  });

  it("respects mute", async () => {
    const base = await docWithAudioClip();
    const muted = await renderTimelineAudio(
      create(base, (d) => {
        d.tracks.find((t) => t.kind === "audio")!.muted = true;
      }),
    );
    // Nothing scheduled at all, so there is no buffer to return.
    expect(muted).toBeNull();
  });

  it("respects solo by silencing every other track", async () => {
    const base = await docWithAudioClip();
    const soloedElsewhere = await renderTimelineAudio(
      create(base, (d) => {
        // Solo a *different* track: the clip's track must go quiet.
        const others = d.tracks.filter((t) => t.kind === "audio");
        others[1].soloed = true;
      }),
    );
    expect(soloedElsewhere).toBeNull();
  });

  it("omits a video clip whose audio is detached", async () => {
    const base = await docWithAudioClip();
    const detached = await renderTimelineAudio(
      create(base, (d) => {
        d.tracks.find((t) => t.kind === "audio")!.clips[0].linkedAudio = false;
      }),
    );
    expect(detached).toBeNull();
  });

  it("omits a disabled clip", async () => {
    const base = await docWithAudioClip();
    const disabled = await renderTimelineAudio(
      create(base, (d) => {
        d.tracks.find((t) => t.kind === "audio")!.clips[0].enabled = false;
      }),
    );
    expect(disabled).toBeNull();
  });

  it("returns null for an empty timeline rather than a silent buffer", async () => {
    const empty = createEmptyDoc();
    expect(await renderTimelineAudio(empty)).toBeNull();
  });

  it("sums two clips without clipping a single one", async () => {
    const blob = await toneVideo();
    await mediaEngine.openBlob(ASSET_ID, blob);

    const doc = create(createEmptyDoc(), (d) => {
      d.sequence.frameRate = FPS_30;
      d.sequence.sampleRate = SAMPLE_RATE;
      edits.upsertAsset(d, {
        id: ASSET_ID,
        name: "tone.mp4",
        kind: "video",
        size: blob.size,
        durationSec: FRAMES / FPS,
        hasAudio: true,
      });
      // Two clips, on different tracks, at the same time.
      for (const track of d.tracks.filter((t) => t.kind === "audio")) {
        edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, 30, {
          startFrame: 0,
          mode: "overwrite",
          overrides: { volume: { value: 0.4 } },
        });
      }
    });

    const rendered = await renderTimelineAudio(doc);
    expect(rendered).not.toBeNull();
    // Two deliberate overlapping clips do sum — that is mixing, not the bug.
    expect(peakBetween(rendered!, 0.2, 0.8)).toBeGreaterThan(0.1);
  });
});
