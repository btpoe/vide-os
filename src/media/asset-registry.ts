/**
 * One demuxer per media file, shared by every clip that uses it.
 *
 * Demuxing — parsing the container, building the sync-sample index — is worth
 * doing once per file. *Decoding* is not shareable, because two clips of the
 * same source sit at different timestamps; that is what `ClipDecoder` is for.
 * Splitting the two is what lets a split clip play both halves at once.
 */

import type { Input, InputAudioTrack, InputVideoTrack } from "mediabunny";
import type { ContentKey } from "@/model/ids";
import type { FileRef } from "@/platform";
import { createBlobSource, createPlatformSource } from "./source";
import { openInput, probeMedia, type ProbeResult } from "./probe";

export interface RegisteredAsset {
  id: ContentKey;
  input: Input;
  videoTrack: InputVideoTrack | null;
  audioTrack: InputAudioTrack | null;
  probe: ProbeResult;
}

const assets = new Map<ContentKey, RegisteredAsset>();
const opening = new Map<ContentKey, Promise<RegisteredAsset>>();

async function open(id: ContentKey, makeInput: () => Input): Promise<RegisteredAsset> {
  const input = makeInput();
  const probe = await probeMedia(input);

  // A file that cannot be read still gets registered, with its problem
  // recorded. The alternative — throwing — leaves the caller with a clip
  // referencing nothing and no way to explain why.
  const [videoTrack, audioTrack] =
    probe.problem?.kind === "decode-failed"
      ? [null, null]
      : await Promise.all([
          input.getPrimaryVideoTrack().catch(() => null),
          input.getPrimaryAudioTrack().catch(() => null),
        ]);

  const asset: RegisteredAsset = { id, input, videoTrack, audioTrack, probe };
  assets.set(id, asset);
  return asset;
}

/** Opens (or returns) the demuxer for a file. Concurrent calls share one open. */
export function registerFromFileRef(
  id: ContentKey,
  ref: FileRef,
): Promise<RegisteredAsset> {
  const existing = assets.get(id);
  if (existing) return Promise.resolve(existing);

  let inFlight = opening.get(id);
  if (!inFlight) {
    inFlight = open(id, () => openInput(createPlatformSource(ref))).finally(() => {
      opening.delete(id);
    });
    opening.set(id, inFlight);
  }
  return inFlight;
}

/** Same, for media that only exists as a blob in this session. */
export function registerFromBlob(id: ContentKey, blob: Blob): Promise<RegisteredAsset> {
  const existing = assets.get(id);
  if (existing) return Promise.resolve(existing);

  let inFlight = opening.get(id);
  if (!inFlight) {
    inFlight = open(id, () => openInput(createBlobSource(blob))).finally(() => {
      opening.delete(id);
    });
    opening.set(id, inFlight);
  }
  return inFlight;
}

export function getAsset(id: ContentKey): RegisteredAsset | undefined {
  return assets.get(id);
}

export function forgetAsset(id: ContentKey): void {
  const asset = assets.get(id);
  if (!asset) return;
  asset.input.dispose();
  assets.delete(id);
}

export function forgetAllAssets(): void {
  for (const id of [...assets.keys()]) forgetAsset(id);
}

export function registeredAssetIds(): ContentKey[] {
  return [...assets.keys()];
}
