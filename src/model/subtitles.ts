/**
 * Subtitles: the model, and the two formats people actually have.
 *
 * Cues are a list on the document rather than clips on a track. A caption is
 * not a piece of media — it has no in-point, no speed, no crop, and nothing to
 * trim against — and importing an hour of dialogue would otherwise mint two
 * thousand clips carrying a full transform and effects payload each. Styling
 * is per-sequence, which is also how subtitles actually work.
 *
 * SRT and VTT are close relatives with incompatible details, and the details
 * are exactly where imported files break:
 *
 * - SRT separates the seconds from the milliseconds with a **comma**; VTT uses
 *   a **dot**. A parser that accepts only one silently rejects half the files
 *   in the world.
 * - VTT may omit the hours field; SRT may not.
 * - Real files in the wild are CRLF, have a UTF-8 BOM, carry VTT cue settings
 *   after the timestamps, and end without a trailing newline. All four are
 *   handled here because all four are common.
 */

import type { FrameRate } from "@/lib/timecode";
import { framesToSeconds, secondsToFrames } from "@/lib/timecode";
import { newId } from "./ids";

export interface SubtitleCue {
  id: string;
  startFrame: number;
  /** Exclusive, like every other span in the document. */
  endFrame: number;
  /** May contain newlines; each is a line break in the rendered caption. */
  text: string;
}

/** How captions are drawn. One style for the sequence, as in every player. */
export interface SubtitleStyle {
  fontFamily: string;
  /** Fraction of frame height, so it means the same at any resolution. */
  fontSize: number;
  color: string;
  /** Background plate behind the text; empty for none. */
  backgroundColor: string;
  /** 0 is the top of the frame, 1 the bottom. Captions usually sit low. */
  y: number;
  bold: boolean;
}

export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    fontFamily: "sans-serif",
    fontSize: 0.055,
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.65)",
    y: 0.88,
    bold: false,
  };
}

// ── Parsing ───────────────────────────────────────────────────────────

export interface ParseResult {
  cues: SubtitleCue[];
  /** Blocks that could not be read, for reporting rather than swallowing. */
  skipped: number;
}

/**
 * Seconds from a timestamp in either dialect.
 *
 * Accepts `HH:MM:SS,mmm`, `HH:MM:SS.mmm` and VTT's `MM:SS.mmm`. Returns null
 * for anything else, which the caller counts rather than guessing at.
 */
export function parseTimestamp(raw: string): number | null {
  const text = raw.trim();
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(text);
  if (!match) return null;

  const [, hours, minutes, seconds, fraction] = match;
  // "5" means 500ms, not 5ms — the field is a decimal fraction, not a count.
  const millis = Number(fraction.padEnd(3, "0"));
  return (
    Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + millis / 1000
  );
}

const TIMING_LINE = /^(.+?)\s*-->\s*([^\s]+)(?:\s+(.*))?$/;

/**
 * Reads SRT or VTT. The dialect is detected rather than declared, because
 * files are routinely named with the wrong extension.
 */
export function parseSubtitles(text: string, rate: FrameRate): ParseResult {
  // A UTF-8 BOM survives `TextDecoder` and would otherwise break the first
  // cue's index or the WEBVTT header check.
  const normalised = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = normalised.split(/\n{2,}/);

  const cues: SubtitleCue[] = [];
  let skipped = 0;

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    // The WEBVTT header, NOTE and STYLE blocks carry no cue.
    if (/^WEBVTT/.test(lines[0]) || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      skipped++;
      continue;
    }

    const match = TIMING_LINE.exec(lines[timingIndex]);
    if (!match) {
      skipped++;
      continue;
    }

    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    if (start === null || end === null) {
      skipped++;
      continue;
    }

    const body = lines
      .slice(timingIndex + 1)
      .join("\n")
      .trim();
    if (body.length === 0) {
      skipped++;
      continue;
    }

    const startFrame = Math.max(0, secondsToFrames(start, rate));
    // At least one frame: a zero-length cue would never be shown, and files
    // with identical start and end timestamps do exist.
    const endFrame = Math.max(startFrame + 1, secondsToFrames(end, rate));

    cues.push({ id: newId("cue"), startFrame, endFrame, text: stripTags(body) });
  }

  cues.sort((a, b) => a.startFrame - b.startFrame);
  return { cues, skipped };
}

/**
 * Removes the inline markup both formats allow.
 *
 * Rendering is a plain rasterised string, so a literal `<i>` in the picture
 * would be worse than losing the italics.
 */
function stripTags(text: string): string {
  return text.replace(/<\/?[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "");
}

// ── Writing ───────────────────────────────────────────────────────────

function pad(value: number, width = 2): string {
  return Math.floor(value).toString().padStart(width, "0");
}

/** `HH:MM:SS,mmm` for SRT, `HH:MM:SS.mmm` for VTT. */
export function formatTimestamp(seconds: number, separator: "," | "."): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis, 3)}`;
}

export function toSrt(cues: readonly SubtitleCue[], rate: FrameRate): string {
  return (
    [...cues]
      .sort((a, b) => a.startFrame - b.startFrame)
      .map((cue, index) => {
        const start = formatTimestamp(framesToSeconds(cue.startFrame, rate), ",");
        const end = formatTimestamp(framesToSeconds(cue.endFrame, rate), ",");
        return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
      })
      // SRT wants a blank line after the last cue as well; several players
      // drop a final cue without one.
      .join("\n\n") + "\n"
  );
}

export function toVtt(cues: readonly SubtitleCue[], rate: FrameRate): string {
  const body = [...cues]
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((cue, index) => {
      const start = formatTimestamp(framesToSeconds(cue.startFrame, rate), ".");
      const end = formatTimestamp(framesToSeconds(cue.endFrame, rate), ".");
      return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
    })
    .join("\n\n");

  return body.length > 0 ? `WEBVTT\n\n${body}\n` : "WEBVTT\n";
}

// ── Queries ───────────────────────────────────────────────────────────

/**
 * The cue covering a frame, or null. Later cues win where they overlap.
 *
 * Cues are sorted by start frame, so the search starts at the last cue that has
 * begun and walks back from there. This used to scan the whole list with no
 * early exit at all — an hour of imported dialogue is a couple of thousand
 * comparisons on every rendered frame.
 *
 * That sounds worse than it measured: 1.8 µs at two thousand cues, against
 * 0.2 µs here, on a 16 ms frame. Worth having because the shape was wrong and
 * the fix is small, not because anything was slow.
 *
 * The walk back is what keeps "later cues win": a cue containing the frame must
 * have started at or before it, so the highest such index is the first hit
 * going down. Cues that do not overlap — nearly all of them — settle on the
 * first check.
 */
export function cueAt(cues: readonly SubtitleCue[], frame: number): SubtitleCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startFrame <= frame) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  for (let i = candidate; i >= 0; i--) {
    const cue = cues[i];
    if (frame >= cue.startFrame && frame < cue.endFrame) return cue;
  }
  return null;
}
