/**
 * Selection-scoped clip edits.
 *
 * These lived inside TimelinePanel's keydown switch, which meant the menu bar
 * could only reach them by dispatching a fake KeyboardEvent at `window`. They
 * only ever touch stores, so nothing about them needs to be panel-local.
 *
 * Both operations are a single `applyEdit`, which matters twice over: deleting
 * four clips is one undo step rather than four, and the undo is a document
 * snapshot rather than a hand-written inverse. The inverse that used to live
 * here re-added deleted clips with fresh ids and dropped their effects, in/out
 * points and transitions, so the paired redo — which removed by the *old* id —
 * did nothing at all.
 */

import { applyEdit, doc, playheadFrame } from "@/stores/project-store";
import * as edits from "@/model/edits";
import { timelineState, clearSelection, selectClip } from "@/stores/timeline-store";

export function hasSelection(): boolean {
  return timelineState.selectedClips.length > 0;
}

export function deleteSelectedClips(): void {
  const refs = [...timelineState.selectedClips];
  if (refs.length === 0) return;

  applyEdit(
    `Delete ${refs.length} clip${refs.length > 1 ? "s" : ""}`,
    (d) => {
      for (const ref of refs) edits.removeClip(d, ref.trackId, ref.clipId);
    },
    { icon: "🗑" },
  );
  clearSelection();
}

/**
 * Moves the selection by whole frames.
 *
 * Frames, not seconds: nudging by `1/fps` accumulated float error and drifted
 * clips off frame boundaries after a few presses.
 */
export function nudgeSelectedClips(frames: number): void {
  const refs = [...timelineState.selectedClips];
  if (refs.length === 0) return;

  applyEdit(
    frames < 0 ? "Nudge left" : "Nudge right",
    (d) => {
      // One call so the group moves together and collision handling sees the
      // whole selection at once.
      edits.nudgeClips(d, refs, frames);
    },
    { icon: "↔️", coalesceKey: `nudge:${refs.map((r) => r.clipId).join(",")}` },
  );
}

/** Whether anything in the selection still exists in the document. */
export function selectionIsLive(): boolean {
  return timelineState.selectedClips.some((ref) =>
    doc()
      .tracks.find((t) => t.id === ref.trackId)
      ?.clips.some((c) => c.id === ref.clipId),
  );
}

// ── Clipboard ─────────────────────────────────────────────────────────

/**
 * The clipboard lives in a module variable, not the document.
 *
 * It is not part of the project — pasting after an undo should still paste
 * what was copied — and it deliberately does not touch the system clipboard,
 * which cannot hold a clip and would make Cmd-C in a text field ambiguous.
 */
let clipboard: edits.ClipboardContents | null = null;

export function hasClipboard(): boolean {
  return clipboard !== null;
}

export function copySelectedClips(): void {
  const refs = [...timelineState.selectedClips];
  if (refs.length === 0) return;
  // Reading the document does not change it, so this is not an undo step.
  clipboard = edits.copyClips(doc(), refs);
}

export function cutSelectedClips(): void {
  copySelectedClips();
  deleteSelectedClips();
}

/**
 * Pastes at the playhead, on the track the selection came from.
 *
 * The pasted clips become the selection, so the usual next move — nudging or
 * dragging them into place — works without a click.
 */
export function pasteClips(): void {
  const contents = clipboard;
  if (!contents) return;

  const targetTrack =
    timelineState.selectedClips[0]?.trackId ??
    doc().tracks.find((t) => t.kind === "video")?.id;
  if (!targetTrack) return;

  let created: string[] = [];
  applyEdit(
    "Paste",
    (d) => {
      created = edits.pasteClips(d, contents, targetTrack, playheadFrame());
    },
    { icon: "📋" },
  );

  clearSelection();
  for (const clipId of created) {
    const track = doc().tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (track) selectClip({ trackId: track.id, clipId }, true);
  }
}

export function duplicateSelectedClips(): void {
  const refs = [...timelineState.selectedClips];
  if (refs.length === 0) return;

  let created: string[] = [];
  applyEdit(
    "Duplicate",
    (d) => {
      created = edits.duplicateClips(d, refs);
    },
    { icon: "⧉" },
  );

  clearSelection();
  for (const clipId of created) {
    const track = doc().tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (track) selectClip({ trackId: track.id, clipId }, true);
  }
}

/** Deletes the selection and closes the gaps it leaves. */
export function rippleDeleteSelectedClips(): void {
  const refs = [...timelineState.selectedClips];
  if (refs.length === 0) return;

  applyEdit(
    `Ripple delete ${refs.length} clip${refs.length > 1 ? "s" : ""}`,
    (d) => edits.rippleDelete(d, refs),
    { icon: "⇤" },
  );
  clearSelection();
}
