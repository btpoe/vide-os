/**
 * Export settings and presets.
 *
 * Two things are deliberately *not* settings.
 *
 * **Frame rate.** It comes from the sequence. Exporting a 29.97 timeline at 30
 * is a resample, not a checkbox, and the old dialog offered it as one — which
 * is part of how frames ended up timestamped by wall clock. The exported file
 * has exactly the timeline's frame rate, and the dialog shows it rather than
 * asking.
 *
 * **The file extension.** It is chosen from what was actually encoded, not
 * from what was requested. The old code picked `.mp4` from the requested
 * format while the mime type silently fell back to WebM, producing a WebM file
 * named `.mp4` that some players refuse.
 */

export type Container = "mp4" | "webm";

export interface ExportSettings {
  container: Container;
  width: number;
  height: number;
  /** Video bits per second. */
  videoBitrate: number;
  /** Audio bits per second. */
  audioBitrate: number;
  includeAudio: boolean;
}

export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  videoBitrate: number;
  /** What this is for, in the user's terms. */
  note: string;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "1080p",
    label: "1080p",
    width: 1920,
    height: 1080,
    videoBitrate: 12_000_000,
    note: "The usual choice for anywhere online.",
  },
  {
    id: "4k",
    label: "4K",
    width: 3840,
    height: 2160,
    videoBitrate: 45_000_000,
    note: "Slow to encode. Worth it only if the footage is genuinely 4K.",
  },
  {
    id: "720p",
    label: "720p",
    width: 1280,
    height: 720,
    videoBitrate: 6_000_000,
    note: "Small and quick, for drafts and review copies.",
  },
  {
    id: "square",
    label: "1080 Square",
    width: 1080,
    height: 1080,
    videoBitrate: 10_000_000,
    note: "1:1 for social. The timeline is letterboxed to fit.",
  },
  {
    id: "vertical",
    label: "1080 Vertical",
    width: 1080,
    height: 1920,
    videoBitrate: 12_000_000,
    note: "9:16 for phones.",
  },
];

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  container: "mp4",
  width: 1920,
  height: 1080,
  videoBitrate: 12_000_000,
  audioBitrate: 192_000,
  includeAudio: true,
};

export function applyPreset(
  settings: ExportSettings,
  preset: ExportPreset,
): ExportSettings {
  return {
    ...settings,
    width: preset.width,
    height: preset.height,
    videoBitrate: preset.videoBitrate,
  };
}

/** Whether a preset matches the current dimensions. */
export function presetMatches(settings: ExportSettings, preset: ExportPreset): boolean {
  return settings.width === preset.width && settings.height === preset.height;
}

/**
 * Encoders want even dimensions; several reject odd ones outright, and the
 * ones that don't pad silently and shift the picture half a pixel.
 */
export function evenDimensions(settings: ExportSettings): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(2, Math.round(settings.width / 2) * 2),
    height: Math.max(2, Math.round(settings.height / 2) * 2),
  };
}
