/**
 * Audio waveform generator.
 * Decodes audio from a File and produces peak data for visualization.
 */

const waveformCache = new Map<string, Float32Array>();
const pendingWaveforms = new Map<string, Promise<Float32Array | null>>();

/**
 * Number of samples per waveform. Each sample is a peak amplitude [0..1].
 */
const WAVEFORM_SAMPLES = 200;

/**
 * Get or generate waveform data for a media entry.
 * Returns null if audio can't be decoded.
 */
export async function getWaveform(
  mediaId: string,
  file: File,
): Promise<Float32Array | null> {
  const cached = waveformCache.get(mediaId);
  if (cached) return cached;

  const pending = pendingWaveforms.get(mediaId);
  if (pending) return pending;

  const promise = generateWaveform(file);
  pendingWaveforms.set(mediaId, promise);

  try {
    const result = await promise;
    if (result) waveformCache.set(mediaId, result);
    return result;
  } finally {
    pendingWaveforms.delete(mediaId);
  }
}

/**
 * Get cached waveform synchronously (returns null if not yet generated).
 */
export function getCachedWaveform(mediaId: string): Float32Array | null {
  return waveformCache.get(mediaId) ?? null;
}

/**
 * Generate waveform peak data from an audio/video file.
 */
async function generateWaveform(file: File): Promise<Float32Array | null> {
  try {
    const audioCtx = new OfflineAudioContext(1, 1, 44100);
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0);
    const samples = new Float32Array(WAVEFORM_SAMPLES);
    const samplesPerBucket = Math.floor(channelData.length / WAVEFORM_SAMPLES);

    for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
      let peak = 0;
      const start = i * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, channelData.length);
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > peak) peak = abs;
      }
      samples[i] = peak;
    }

    return samples;
  } catch {
    return null;
  }
}

/**
 * Convert waveform data to an SVG path string for rendering.
 * Draws a mirrored waveform (top and bottom halves).
 */
export function waveformToSvgPath(
  data: Float32Array,
  width: number,
  height: number,
  startFraction: number = 0,
  endFraction: number = 1,
): string {
  const startIdx = Math.floor(startFraction * data.length);
  const endIdx = Math.ceil(endFraction * data.length);
  const visibleSamples = endIdx - startIdx;
  if (visibleSamples <= 0) return "";

  const midY = height / 2;
  const stepX = width / visibleSamples;
  const maxAmp = height / 2 - 1;

  // Top half
  let path = `M 0 ${midY}`;
  for (let i = 0; i < visibleSamples; i++) {
    const x = i * stepX;
    const amp = data[startIdx + i] * maxAmp;
    path += ` L ${x.toFixed(1)} ${(midY - amp).toFixed(1)}`;
  }

  // Bottom half (reverse)
  for (let i = visibleSamples - 1; i >= 0; i--) {
    const x = i * stepX;
    const amp = data[startIdx + i] * maxAmp;
    path += ` L ${x.toFixed(1)} ${(midY + amp).toFixed(1)}`;
  }

  path += " Z";
  return path;
}

/**
 * Clear cached waveform for a media entry.
 */
export function clearWaveform(mediaId: string): void {
  waveformCache.delete(mediaId);
}

/**
 * Clear all cached waveforms.
 */
export function clearAllWaveforms(): void {
  waveformCache.clear();
}
