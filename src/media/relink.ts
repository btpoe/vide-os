/**
 * Reconnecting a project to its media.
 *
 * Two ways in, both driven by a click because both may prompt:
 *
 * - **Re-grant**: the handle is still stored, the browser has just forgotten
 *   the permission. This is the common case after a reload and needs no file
 *   picking at all.
 * - **Relink**: point at a file, or a folder to match many at once. Candidates
 *   are matched by name and size first because that is cheap, then *verified by
 *   content key* — so relinking to a file that happens to share a name but is
 *   not the same recording is caught rather than silently accepted.
 */

import { platform, type DirRef, type FileRef } from "@/platform";
import { computeContentKey } from "@/model/ids";
import { mediaEngine } from "@/media/engine";
import { applyEdit, doc } from "@/stores/project-store";
import * as edits from "@/model/edits";
import { addMediaEntry, mediaState, reconnectPendingMedia } from "@/stores/media-store";
import { getMediaType } from "@/lib/fs-access";

export interface RelinkResult {
  reconnected: string[];
  /** Files the user offered that did not match any missing asset. */
  unmatched: string[];
}

/**
 * Re-grants access to media whose permission lapsed.
 *
 * **Must be called from a user gesture.** Returns how many came back.
 */
export async function regrantPermissions(): Promise<number> {
  return reconnectPendingMedia();
}

/** Adopts a file as the source for an asset, verifying it really is that asset. */
async function adopt(assetId: string, ref: FileRef): Promise<boolean> {
  const blob = await platform.fs.readBlob(ref);
  const key = await computeContentKey(blob);
  if (key !== assetId) return false;

  await mediaEngine.openFile(assetId, ref);

  const asset = doc().assets.find((a) => a.id === assetId);
  addMediaEntry({
    id: assetId,
    name: ref.name,
    type: getMediaType(ref.name),
    size: ref.size,
    ref,
    duration: asset?.durationSec,
  });

  // Clear the recorded problem now that the file is back.
  applyEdit(`Relink ${ref.name}`, (d) => edits.setAssetProblem(d, assetId, undefined), {
    icon: "🔗",
  });
  return true;
}

/**
 * Relinks one asset to a file the user picks.
 *
 * Returns false when the chosen file is not the same media — a different
 * recording with the same name is the case worth catching.
 */
export async function relinkOne(assetId: string): Promise<boolean> {
  const [ref] = await platform.fs.pickOpenFiles({ multiple: false });
  if (!ref) return false;
  return adopt(assetId, ref);
}

/**
 * Relinks as many missing assets as possible from a folder.
 *
 * Name and size narrow the candidates cheaply; the content key is what
 * actually decides, so a coincidental name match cannot slip through.
 */
export async function relinkFromFolder(
  missingAssetIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<RelinkResult> {
  const dir: DirRef | null = await platform.fs.pickDirectory();
  if (!dir) return { reconnected: [], unmatched: [] };

  const entries = await platform.fs.readDir(dir);
  const files = entries.filter((e) => e.kind === "file");

  const missing = doc().assets.filter((a) => missingAssetIds.includes(a.id));
  const reconnected: string[] = [];
  const unmatched: string[] = [];

  let done = 0;
  for (const asset of missing) {
    // Cheap filter first: hashing every file in a folder to find one match
    // would read the whole folder.
    const candidates = files.filter(
      (f) => f.name === asset.name || (f.ref as FileRef).size === asset.size,
    );

    let found = false;
    for (const candidate of candidates) {
      if (await adopt(asset.id, candidate.ref as FileRef)) {
        reconnected.push(asset.id);
        found = true;
        break;
      }
    }
    if (!found) unmatched.push(asset.name);

    onProgress?.(++done, missing.length);
  }

  return { reconnected, unmatched };
}

/** Whether anything is currently waiting on a permission re-grant. */
export function hasPendingPermissions(): boolean {
  return mediaState.pendingPermission.length > 0;
}
