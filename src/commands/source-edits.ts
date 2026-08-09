/**
 * Edits from the source monitor into the timeline.
 *
 * The three-point edit: in and out are marked on the source, the playhead is
 * the third point, and the fourth — where it ends on the timeline — follows
 * from the length. Insert pushes everything after it; overwrite replaces what
 * it lands on.
 */

import {
  applyEdit,
  doc,
  playheadFrame,
  setPlayheadFrame,
} from "@/stores/project-store";
import * as edits from "@/model/edits";
import {
  sourceAssetId,
  inFrame,
  effectiveOut,
  markedLength,
} from "@/stores/source-store";
import { targetTrackId, clearSelection, selectClip } from "@/stores/timeline-store";
import { clipEndFrame } from "@/model/doc";

export function canEditFromSource(): boolean {
  return sourceAssetId() !== null && markedLength() >= 1;
}

/**
 * Puts the marked range of the source on the target track at the playhead.
 *
 * The playhead moves to the end of what was added, which is what makes
 * assembling a sequence a matter of pressing one key repeatedly.
 */
export function insertFromSource(mode: "insert" | "overwrite"): void {
  const assetId = sourceAssetId();
  if (!assetId || markedLength() < 1) return;

  const asset = doc().assets.find((a) => a.id === assetId);
  // Audio-only media belongs on an audio track; anything else on a video one.
  const kind = asset?.kind === "audio" ? "audio" : "video";
  const trackId = targetTrackId(kind);
  if (!trackId) return;

  let createdId: string | undefined;
  applyEdit(
    mode === "insert" ? "Insert from source" : "Overwrite from source",
    (d) => {
      createdId = edits.threePointEdit(d, trackId, {
        assetId,
        inPointFrames: inFrame(),
        outPointFrames: effectiveOut(),
        atFrame: playheadFrame(),
        mode,
      })?.id;
    },
    { icon: mode === "insert" ? "⇥" : "⇩" },
  );

  if (!createdId) return;

  const track = doc().tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === createdId);
  if (!clip) return;

  clearSelection();
  selectClip({ trackId, clipId: clip.id });
  // Ready for the next edit, which is the whole point of the gesture.
  setPlayheadFrame(clipEndFrame(clip));
}
