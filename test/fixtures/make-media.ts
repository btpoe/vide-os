/**
 * Generated test media.
 *
 * Fixtures are encoded at test time rather than committed, so no binaries live
 * in git and the codec used is always one this browser can actually decode.
 *
 * Every video fixture carries a **burned-in frame counter**, drawn as a row of
 * black and white blocks encoding the frame number in binary. That turns "is
 * this the right frame?" — the question the whole media engine exists to
 * answer — into reading a few pixels, which is why frame-accuracy assertions
 * elsewhere can be exact rather than approximate.
 */

import {
  BufferTarget,
  Mp4OutputFormat,
  Output,
  VideoSampleSource,
  AudioBufferSource,
  VideoSample,
  QUALITY_LOW,
  getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec,
} from "mediabunny";

export interface FixtureOptions {
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  withAudio?: boolean;
  /** Tone frequency in Hz, for locating a position in the audio. */
  toneHz?: number;
  /**
   * Amplitude at a time in seconds, so a fixture can carry a known envelope.
   * Defaults to a constant 0.5 — which is a fine tone and a useless waveform,
   * since every peak comes out the same.
   */
  toneGain?: (seconds: number) => number;
}

/**
 * Bits used to encode the frame number. 8 bits covers 0..255, which is more
 * than any fixture here needs.
 */
const MARKER_BITS = 8;

/**
 * Draws the frame number as a row of black and white blocks.
 *
 * An earlier version encoded the number in the fill colour and read the RGB
 * back. That cannot work: the fixtures are H.264, which is lossy and 4:2:0, so
 * exact channel values do not survive a round trip — frame 3 came back as 514.
 * Large blocks of pure black and white differ in *luma* by the maximum
 * possible amount, which is exactly what a video codec preserves best.
 */
function drawFrameMarker(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "rgb(96,96,96)";
  ctx.fillRect(0, 0, width, height);

  const blockWidth = width / MARKER_BITS;
  const blockHeight = Math.max(8, Math.floor(height / 3));
  for (let bit = 0; bit < MARKER_BITS; bit++) {
    const on = (frame >> bit) & 1;
    ctx.fillStyle = on ? "rgb(255,255,255)" : "rgb(0,0,0)";
    ctx.fillRect(bit * blockWidth, height - blockHeight, blockWidth, blockHeight);
  }

  // Also draw it legibly, so a failing golden-frame diff can be read by eye.
  ctx.fillStyle = "white";
  ctx.font = `${Math.floor(height / 4)}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(String(frame), 4, 4);
}

/**
 * Reads the frame number back out of a decoded frame.
 *
 * Thresholds each block at mid-luma, so it tolerates whatever the codec did to
 * the exact values.
 */
export function readFrameMarker(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  const blockWidth = width / MARKER_BITS;
  const blockHeight = Math.max(8, Math.floor(height / 3));
  const y = Math.floor(height - blockHeight / 2);

  let frame = 0;
  for (let bit = 0; bit < MARKER_BITS; bit++) {
    const x = Math.floor(bit * blockWidth + blockWidth / 2);
    const { data } = ctx.getImageData(x, y, 1, 1);
    const luma = 0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2];
    if (luma > 128) frame |= 1 << bit;
  }
  return frame;
}

/**
 * Encodes a short MP4 with a burned-in frame counter and optionally a tone.
 *
 * Codecs are chosen by asking what this browser can encode, so the fixture is
 * always decodable here.
 */
export async function makeTestVideo(options: FixtureOptions = {}): Promise<Blob> {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const fps = options.fps ?? 30;
  const frames = options.frames ?? 30;

  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], {
    width,
    height,
  });
  if (!videoCodec) throw new Error("No encodable video codec in this browser");

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  const videoSource = new VideoSampleSource({
    codec: videoCodec,
    bitrate: QUALITY_LOW,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });

  let audioSource: AudioBufferSource | null = null;
  if (options.withAudio) {
    const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"], {
      numberOfChannels: 1,
      sampleRate: 48000,
    });
    if (audioCodec) {
      audioSource = new AudioBufferSource({
        codec: audioCodec,
        bitrate: QUALITY_LOW,
      });
      output.addAudioTrack(audioSource);
    }
  }

  await output.start();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context for the fixture canvas");

  for (let frame = 0; frame < frames; frame++) {
    drawFrameMarker(ctx, frame, width, height);
    const sample = new VideoSample(canvas, {
      timestamp: frame / fps,
      duration: 1 / fps,
    });
    await videoSource.add(sample);
    sample.close();
  }
  videoSource.close();

  if (audioSource) {
    const sampleRate = 48000;
    const durationSec = frames / fps;
    const length = Math.floor(sampleRate * durationSec);
    const context = new OfflineAudioContext(1, length, sampleRate);
    const buffer = context.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);
    const hz = options.toneHz ?? 440;
    const gain = options.toneGain ?? (() => 0.5);
    for (let i = 0; i < length; i++) {
      channel[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * gain(i / sampleRate);
    }
    await audioSource.add(buffer);
    audioSource.close();
  }

  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("Fixture encoding produced no output");
  return new Blob([buffer], { type: "video/mp4" });
}
