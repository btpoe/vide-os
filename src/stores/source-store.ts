import { createSignal } from "solid-js";
import { doc, assets } from "@/stores/project-store";
import { assetDurationFrames, type Asset } from "@/model/doc";
import type { ContentKey } from "@/model/ids";

/**
 * The clip loaded in the source monitor.
 *
 * A source is not part of the project: marking in and out on a piece of media
 * you end up not using should leave no trace, and it must not be undoable —
 * undo is for the edit, not for looking at footage. So this is plain signal
 * state rather than anything in the document.
 */

const [sourceAssetId, setSourceAssetId] = createSignal<ContentKey | null>(null);
const [inFrame, setInFrame] = createSignal(0);
const [outFrame, setOutFrame] = createSignal<number | null>(null);
const [sourceFrame, setSourceFrameSignal] = createSignal(0);

export { sourceAssetId, inFrame, outFrame, sourceFrame };

export function sourceAsset(): Asset | undefined {
  const id = sourceAssetId();
  return id ? assets().find((a) => a.id === id) : undefined;
}

/** Length of the loaded source in frames, or 0 when nothing is loaded. */
export function sourceLengthFrames(): number {
  const asset = sourceAsset();
  if (!asset) return 0;
  return assetDurationFrames(asset, doc().sequence.frameRate) ?? 0;
}

/** The out point, defaulting to the end of the media. */
export function effectiveOut(): number {
  return outFrame() ?? sourceLengthFrames();
}

/** Frames the marked range covers. Always at least one when a source is loaded. */
export function markedLength(): number {
  return Math.max(0, effectiveOut() - inFrame());
}

/** Loads a source, resetting the marks — they belonged to the previous one. */
export function loadSource(assetId: ContentKey): void {
  setSourceAssetId(assetId);
  setInFrame(0);
  setOutFrame(null);
  setSourceFrameSignal(0);
}

export function clearSource(): void {
  setSourceAssetId(null);
  setInFrame(0);
  setOutFrame(null);
  setSourceFrameSignal(0);
}

export function setSourceFrame(frame: number): void {
  const last = Math.max(0, sourceLengthFrames() - 1);
  setSourceFrameSignal(Math.max(0, Math.min(last, Math.round(frame))));
}

/**
 * Marks the in point at the current position.
 *
 * Pushes the out point along if it would end up behind — a range that runs
 * backwards is never what anyone meant, and refusing the mark is more
 * annoying than adjusting the other end.
 */
export function markIn(): void {
  const frame = sourceFrame();
  setInFrame(frame);
  const out = outFrame();
  if (out !== null && out <= frame) setOutFrame(frame + 1);
}

export function markOut(): void {
  const frame = sourceFrame() + 1; // Exclusive, like every span in the document.
  setOutFrame(frame);
  if (inFrame() >= frame) setInFrame(Math.max(0, frame - 1));
}

/** Drops the marks, so the whole clip is used. */
export function clearMarks(): void {
  setInFrame(0);
  setOutFrame(null);
}

export { setInFrame, setOutFrame };
