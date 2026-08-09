/**
 * Markers out as chapters.
 *
 * Two formats, because they are what people actually paste somewhere: a
 * YouTube description block, and WebVTT chapters for a `<track kind="chapters">`
 * or a player that reads them.
 *
 * Both are pure string functions over the document, so they are testable
 * without a browser and cannot drift from what is on the timeline.
 */

import type { Marker, ProjectDoc } from "./doc";
import { contentEndFrame } from "./doc";
import { framesToSeconds, type FrameRate } from "@/lib/timecode";

/** `H:MM:SS`, or `M:SS` under an hour — what YouTube expects. */
export function chapterTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/** `HH:MM:SS.mmm`, which WebVTT requires in full even under an hour. */
export function vttTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, width = 2) => n.toString().padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`;
}

function sorted(markers: readonly Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.frame - b.frame);
}

/**
 * A YouTube chapter list.
 *
 * YouTube only recognises the list if the first entry is at 0:00, so one is
 * added when the first marker is not at the start — otherwise the whole block
 * is silently ignored, which is a maddening thing to debug from the other end.
 */
export function toYouTubeChapters(doc: ProjectDoc): string {
  const markers = sorted(doc.markers);
  if (markers.length === 0) return "";

  const rate = doc.sequence.frameRate;
  const lines: string[] = [];

  if (markers[0].frame > 0) lines.push("0:00 Start");
  for (const marker of markers) {
    const label = marker.name.trim() || "Chapter";
    lines.push(`${chapterTimestamp(framesToSeconds(marker.frame, rate))} ${label}`);
  }
  return lines.join("\n");
}

/**
 * WebVTT chapters.
 *
 * Each cue runs to the next marker, and the last one to the end of the
 * content — a cue needs an end time, and markers are points.
 */
export function toVttChapters(doc: ProjectDoc): string {
  const markers = sorted(doc.markers);
  if (markers.length === 0) return "WEBVTT\n";

  const rate: FrameRate = doc.sequence.frameRate;
  const endFrame = Math.max(
    contentEndFrame(doc),
    markers[markers.length - 1].frame + 1,
  );

  const cues = markers.map((marker, index) => {
    const start = framesToSeconds(marker.frame, rate);
    const nextFrame = markers[index + 1]?.frame ?? endFrame;
    const end = framesToSeconds(nextFrame, rate);
    const label = marker.name.trim() || `Chapter ${index + 1}`;
    return `${index + 1}\n${vttTimestamp(start)} --> ${vttTimestamp(end)}\n${label}`;
  });

  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** Markers as a plain list, for pasting into notes. */
export function toMarkerList(doc: ProjectDoc): string {
  const rate = doc.sequence.frameRate;
  return sorted(doc.markers)
    .map((marker) => {
      const time = chapterTimestamp(framesToSeconds(marker.frame, rate));
      const name = marker.name.trim() || "Marker";
      const note = marker.note?.trim();
      return note ? `${time}\t${name}\t${note}` : `${time}\t${name}`;
    })
    .join("\n");
}
