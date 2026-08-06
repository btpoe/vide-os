/**
 * Frame rates, frame/second conversion, and SMPTE timecode.
 *
 * Frame rate is rational, not a float. 29.97 is exactly 30000/1001 and 23.976
 * is 24000/1001 — storing them as decimals accumulates error that shows up as
 * off-by-one frames on long timelines and as gaps when clips are butted
 * together. Every duration in the document is an integer frame count; seconds
 * are a derived, lossy view used only for display and for talking to Web Audio.
 */

export interface FrameRate {
  /** Frames per `den` seconds. 30000/1001 is 29.97. */
  num: number;
  den: number;
}

export const FPS_24: FrameRate = { num: 24, den: 1 };
export const FPS_23_976: FrameRate = { num: 24000, den: 1001 };
export const FPS_25: FrameRate = { num: 25, den: 1 };
export const FPS_29_97: FrameRate = { num: 30000, den: 1001 };
export const FPS_30: FrameRate = { num: 30, den: 1 };
export const FPS_50: FrameRate = { num: 50, den: 1 };
export const FPS_59_94: FrameRate = { num: 60000, den: 1001 };
export const FPS_60: FrameRate = { num: 60, den: 1 };

export const FRAME_RATE_PRESETS: { label: string; rate: FrameRate }[] = [
  { label: "23.976", rate: FPS_23_976 },
  { label: "24", rate: FPS_24 },
  { label: "25", rate: FPS_25 },
  { label: "29.97", rate: FPS_29_97 },
  { label: "30", rate: FPS_30 },
  { label: "50", rate: FPS_50 },
  { label: "59.94", rate: FPS_59_94 },
  { label: "60", rate: FPS_60 },
];

export function frameRateToNumber(rate: FrameRate): number {
  return rate.num / rate.den;
}

/**
 * Best rational approximation of a decimal frame rate, used when reading old
 * projects that stored fps as a number. 29.97 and 23.976 are recognised as the
 * NTSC rates they were rounded from rather than taken literally.
 */
export function frameRateFromNumber(fps: number): FrameRate {
  const known = FRAME_RATE_PRESETS.find(
    ({ rate }) => Math.abs(frameRateToNumber(rate) - fps) < 0.005,
  );
  if (known) return known.rate;
  // Unknown rate: keep it exact if integral, otherwise scale by 1000.
  if (Number.isInteger(fps)) return { num: fps, den: 1 };
  return { num: Math.round(fps * 1000), den: 1000 };
}

export function framesToSeconds(frames: number, rate: FrameRate): number {
  return (frames * rate.den) / rate.num;
}

/**
 * Seconds to the nearest frame. Rounds rather than truncates: a playhead at
 * 1.9999 s on a 30 fps timeline is frame 60, not frame 59.
 */
export function secondsToFrames(seconds: number, rate: FrameRate): number {
  return Math.round((seconds * rate.num) / rate.den);
}

/** Seconds per frame — the smallest meaningful step on the timeline. */
export function frameDurationSeconds(rate: FrameRate): number {
  return rate.den / rate.num;
}

/**
 * Whether this rate uses SMPTE drop-frame numbering. Only the NTSC rates
 * (29.97 and 59.94) do; drop-frame drops frame *numbers*, never frames, so
 * wall-clock time and timecode stay within a couple of frames over an hour.
 */
export function isDropFrame(rate: FrameRate): boolean {
  return rate.den === 1001 && (rate.num === 30000 || rate.num === 60000);
}

/** Nominal integer frames per second used for timecode counting. */
function nominalFps(rate: FrameRate): number {
  return Math.round(frameRateToNumber(rate));
}

function pad(n: number, width = 2): string {
  return Math.abs(n).toString().padStart(width, "0");
}

/**
 * SMPTE timecode, `HH:MM:SS:FF` (`HH:MM:SS;FF` for drop-frame).
 *
 * Drop-frame skips frame numbers 0 and 1 at the top of every minute except
 * every tenth minute, which keeps the displayed timecode aligned with real
 * elapsed time on 29.97/59.94 material.
 */
export function framesToTimecode(frames: number, rate: FrameRate): string {
  const fps = nominalFps(rate);
  const negative = frames < 0;
  const f = Math.abs(Math.round(frames));

  if (isDropFrame(rate)) {
    // Frames dropped per minute (2 at 29.97, 4 at 59.94) and the counts of a
    // nominal minute and ten-minute block in *frame numbers*.
    const dropPerMinute = fps / 15;
    const framesPer10Min = fps * 60 * 10 - 9 * dropPerMinute;
    const framesPerMin = fps * 60 - dropPerMinute;

    const tenMinBlocks = Math.floor(f / framesPer10Min);
    let rem = f % framesPer10Min;

    // The first minute of each ten-minute block drops nothing.
    const firstMinute = fps * 60;
    let minutesInBlock = 0;
    if (rem >= firstMinute) {
      rem -= firstMinute;
      minutesInBlock = 1 + Math.floor(rem / framesPerMin);
      rem = rem % framesPerMin;
    }

    const totalMinutes = tenMinBlocks * 10 + minutesInBlock;
    // Minutes that drop frames have their numbering shifted forward.
    const displayFrames = minutesInBlock > 0 ? rem + dropPerMinute : rem;

    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    const ss = Math.floor(displayFrames / fps);
    const ff = displayFrames % fps;
    return `${negative ? "-" : ""}${pad(hh)}:${pad(mm)}:${pad(ss)};${pad(ff)}`;
  }

  const ff = f % fps;
  const totalSeconds = Math.floor(f / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${negative ? "-" : ""}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** Parses `HH:MM:SS:FF`, `MM:SS:FF`, or `SS:FF`. Returns null if malformed. */
export function timecodeToFrames(timecode: string, rate: FrameRate): number | null {
  const trimmed = timecode.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;

  const parts = body.split(/[:;]/);
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts.some((p) => p === "" || !/^\d+$/.test(p))) return null;

  const nums = parts.map(Number);
  while (nums.length < 4) nums.unshift(0);
  const [hh, mm, ss, ff] = nums;

  const fps = nominalFps(rate);
  if (ff >= fps || ss >= 60 || mm >= 60) return null;

  let frames: number;
  if (isDropFrame(rate)) {
    const dropPerMinute = fps / 15;
    const totalMinutes = hh * 60 + mm;
    frames =
      hh * 3600 * fps +
      mm * 60 * fps +
      ss * fps +
      ff -
      dropPerMinute * (totalMinutes - Math.floor(totalMinutes / 10));
  } else {
    frames = ((hh * 60 + mm) * 60 + ss) * fps + ff;
  }
  return negative ? -frames : frames;
}

/**
 * Compact duration for clip labels and media lists: `M:SS` under an hour,
 * `H:MM:SS` above it. Not timecode — no frame component.
 */
export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const ss = total % 60;
  const mm = Math.floor(total / 60) % 60;
  const hh = Math.floor(total / 3600);
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
