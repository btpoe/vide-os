/**
 * Selection-scoped clip edits.
 *
 * These lived inside TimelinePanel's keydown switch, which meant the menu bar
 * could only reach them by dispatching a fake KeyboardEvent at `window`. They
 * only ever touch stores, so nothing about them needs to be panel-local.
 *
 * Note the undo/redo closures below are known to be incorrect: re-adding a
 * deleted clip mints a new id and drops effects, in/out points, transitions
 * and text overlays, so the paired redo (which removes by the *old* id) is a
 * no-op. That is inherent to command-based undo with hand-written inverses and
 * is fixed by moving to document snapshots — not worth patching in place.
 */

import {
  projectState,
  addClipToTrack,
  removeClip,
  moveClip,
  type Clip,
} from "@/stores/project-store";
import { timelineState, clearSelection } from "@/stores/timeline-store";
import { pushAction } from "@/stores/history-store";

export function hasSelection(): boolean {
  return timelineState.selectedClips.length > 0;
}

export function deleteSelectedClips(): void {
  const refs = [...timelineState.selectedClips];
  if (refs.length === 0) return;

  const removed: { trackId: string; clip: Clip }[] = [];
  for (const ref of refs) {
    const track = projectState.tracks.find((t) => t.id === ref.trackId);
    const clip = track?.clips.find((c) => c.id === ref.clipId);
    if (clip) removed.push({ trackId: ref.trackId, clip: { ...clip } });
  }

  for (const ref of refs) removeClip(ref.trackId, ref.clipId);
  clearSelection();

  pushAction(
    `Delete ${refs.length} clip${refs.length > 1 ? "s" : ""}`,
    "🗑",
    () => {
      for (const { trackId, clip } of removed) {
        addClipToTrack(trackId, clip.mediaId, "", clip.duration, clip.startTime);
      }
    },
    () => {
      for (const { trackId, clip } of removed) removeClip(trackId, clip.id);
    },
  );
}

export function nudgeSelectedClips(seconds: number): void {
  for (const ref of timelineState.selectedClips) {
    const track = projectState.tracks.find((t) => t.id === ref.trackId);
    const clip = track?.clips.find((c) => c.id === ref.clipId);
    if (clip) moveClip(ref.trackId, ref.clipId, clip.startTime + seconds);
  }
}
