/**
 * What is wrong with the project's media, and what the user can do about it.
 *
 * Three distinct situations that used to look identical — a black clip and no
 * explanation:
 *
 * - **offline**: the document references media this session has never opened.
 *   Usually a project moved between machines. Needs relinking to a file.
 * - **needs-permission**: the file handle survived but the browser has
 *   forgotten the grant. Needs one click, inside a user gesture.
 * - **undecodable**: the file is here and readable, but this browser cannot
 *   decode its codec. Needs converting.
 *
 * They are separated because the remedy differs, and offering "relink" for a
 * file that is present but in the wrong codec would waste the user's time.
 */

import { createMemo } from "solid-js";
import { doc } from "@/stores/project-store";
import { mediaState } from "@/stores/media-store";
import { getAsset } from "@/media/asset-registry";
import type { Asset } from "@/model/doc";

export type MediaProblemKind = "offline" | "needs-permission" | "undecodable";

export interface MediaProblem {
  assetId: string;
  name: string;
  kind: MediaProblemKind;
  detail: string;
  /** Clips that will not render because of this. */
  clipCount: number;
}

function clipsUsing(assetId: string): number {
  let count = 0;
  for (const track of doc().tracks) {
    for (const clip of track.clips) {
      if (clip.source.type === "asset" && clip.source.assetId === assetId) count++;
    }
  }
  return count;
}

function classify(asset: Asset): MediaProblem | null {
  const inPool = mediaState.entries.some((e) => e.id === asset.id);
  const registered = getAsset(asset.id);

  // The engine has opened it and reported a codec problem.
  if (registered?.probe.problem) {
    const kind: MediaProblemKind =
      registered.probe.problem.kind === "unsupported-codec" ? "undecodable" : "offline";
    return {
      assetId: asset.id,
      name: asset.name,
      kind,
      detail: registered.probe.problem.detail,
      clipCount: clipsUsing(asset.id),
    };
  }

  // Stored handle exists but permission lapsed — one click fixes it.
  if (mediaState.pendingPermission.some((p) => p.mediaId === asset.id)) {
    return {
      assetId: asset.id,
      name: asset.name,
      kind: "needs-permission",
      detail: "The browser needs permission to read this file again.",
      clipCount: clipsUsing(asset.id),
    };
  }

  if (!inPool) {
    return {
      assetId: asset.id,
      name: asset.name,
      kind: "offline",
      detail:
        asset.problem?.detail ??
        "This file has not been opened in this session. Relink it to continue.",
      clipCount: clipsUsing(asset.id),
    };
  }

  return null;
}

/** Every asset the project cannot currently use. */
export const mediaProblems = createMemo<MediaProblem[]>(() =>
  doc()
    .assets.map(classify)
    .filter((problem): problem is MediaProblem => problem !== null),
);

export const hasMediaProblems = createMemo(() => mediaProblems().length > 0);

/** Problems that a permission re-grant would fix, which needs a user gesture. */
export const permissionProblems = createMemo(() =>
  mediaProblems().filter((p) => p.kind === "needs-permission"),
);

/** Problems needing the user to point at a file. */
export const relinkProblems = createMemo(() =>
  mediaProblems().filter((p) => p.kind === "offline"),
);

export function problemFor(assetId: string): MediaProblem | undefined {
  return mediaProblems().find((p) => p.assetId === assetId);
}
