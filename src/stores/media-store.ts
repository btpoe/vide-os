import { createStore } from "solid-js/store";
import {
  type MediaType,
  getMediaType,
  getDecodeSupport,
  getFileFromHandle,
  generateImageThumbnail,
  saveFileHandle,
  loadAllFileHandles,
  removeFileHandle,
  verifyFilePermission,
  requestFilePermission,
} from "@/lib/fs-access";
import { clearAllFilmstrips, clearFilmstrip, posterFrame } from "@/lib/clip-thumbnails";
import { clearAllWaveforms, clearWaveform } from "@/lib/waveform-cache";
import { computeContentKey } from "@/model/ids";
import { mediaEngine } from "@/media/engine";
import { platform, type FileRef } from "@/platform";
import { registerAsset } from "@/stores/project-store";
import type { Asset, AssetKind, AssetProblem } from "@/model/doc";

export interface MediaEntry {
  id: string;
  name: string;
  type: MediaType;
  size: number;
  /**
   * How this entry's bytes are reached.
   *
   * A file imported through the File Browser has a handle; one adopted by
   * relinking has only a platform reference. Exactly one is set — use
   * `entryFile` rather than reading either directly.
   */
  handle?: FileSystemFileHandle;
  ref?: FileRef;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  /**
   * What the demuxer found wrong with the file, once it has been probed.
   *
   * Absent until then, which is not the same as "nothing wrong" — see
   * `syncAssetToDocument`, which falls back to the extension guess in the gap.
   */
  problem?: AssetProblem;
  /** Whether the demuxer has been asked. Distinguishes "no problem" from "not yet". */
  probed?: boolean;
  importing?: boolean;
}

interface MediaStoreState {
  entries: MediaEntry[];
  directoryHandle: FileSystemDirectoryHandle | null;
  selectedIds: string[];
  /**
   * Media whose stored handle exists but whose permission has lapsed. The
   * handle is kept; the user re-grants access from a click.
   */
  pendingPermission: { mediaId: string; handle: FileSystemFileHandle }[];
}

const [mediaState, setMediaState] = createStore<MediaStoreState>({
  entries: [],
  directoryHandle: null,
  selectedIds: [],
  pendingPermission: [],
});

/**
 * Mirrors a pool entry into the document's asset table.
 *
 * A clip may only reference an asset the document knows about, so this has to
 * happen before the media can be dropped on the timeline. It is called again
 * once probing finishes, to fill in the duration the timeline needs in order
 * to clamp clips to the source.
 */
function syncAssetToDocument(entry: MediaEntry): void {
  const kind: AssetKind =
    entry.type === "audio" ? "audio" : entry.type === "image" ? "image" : "video";

  const asset: Asset = {
    id: entry.id,
    name: entry.name,
    kind,
    size: entry.size,
    // Images have no intrinsic duration; give them a default so a clip can be
    // clamped to something rather than being treated as unbounded.
    durationSec: entry.duration ?? (kind === "image" ? 5 : 0),
    width: entry.width,
    height: entry.height,
    hasAudio: entry.hasAudio ?? false,
  };

  // The probe is the real answer — it asked this browser about this file's
  // actual codecs. The extension guess only stands in for the moment between
  // the entry appearing and the demuxer having read it, so that a `.mkv`
  // dropped on the timeline is not silently accepted in the meantime.
  if (entry.problem) {
    asset.problem = entry.problem;
  } else if (!entry.probed && getDecodeSupport(entry.name) === "needs-conversion") {
    asset.problem = {
      kind: "unsupported-codec",
      detail: `${entry.name.split(".").pop()?.toUpperCase() ?? "This format"} is not decodable in the browser. Convert it to MP4 or WebM first.`,
    };
  }

  registerAsset(asset);
}

/**
 * The file's own account of itself, and the engine's copy of it.
 *
 * Two things happen here, and they belong together. The file is opened in the
 * media engine — which is what was missing: `DecoderPool` looks the asset up in
 * that registry, and nothing but relinking ever put anything in it, so every
 * imported clip decoded to nothing and the preview stayed black. And the probe
 * it returns becomes the single source of truth for duration, dimensions and
 * audio, replacing a `<video>` element that guessed all three — `hasAudio` from
 * `webkitAudioDecodedByteCount`, which is 0 until something has played, so a
 * file with sound imported as silent.
 *
 * Images are not containers and have no demuxer; they keep their defaults.
 */
async function describeThroughEngine(
  id: string,
  file: File | Blob,
  type: MediaType,
): Promise<Partial<MediaEntry>> {
  if (type === "image") return { probed: true };

  try {
    const { probe } = await mediaEngine.openBlob(id, file);
    return {
      probed: true,
      duration: probe.durationSec > 0 ? probe.durationSec : undefined,
      width: probe.video?.width,
      height: probe.video?.height,
      hasAudio: probe.audio !== null,
      problem: probe.problem,
    };
  } catch (error) {
    // `probeMedia` does not throw for a bad file — it reports a problem — so
    // reaching here means the bytes could not be read at all.
    return {
      probed: true,
      hasAudio: false,
      problem: {
        kind: "decode-failed",
        detail:
          error instanceof Error
            ? `Could not read this file: ${error.message}`
            : "Could not read this file.",
      },
    };
  }
}

/**
 * Reads an entry's file, whichever way it was obtained.
 *
 * Callers must not reach for `handle` themselves: a relinked entry does not
 * have one, and pretending otherwise crashes at the first thumbnail.
 */
export async function entryFile(entry: MediaEntry): Promise<File | Blob | null> {
  if (entry.handle) return getFileFromHandle(entry.handle);
  if (entry.ref) return platform.fs.readBlob(entry.ref);
  return null;
}

export function addMediaEntry(entry: MediaEntry): void {
  // Prevent duplicates by handle name
  const exists = mediaState.entries.some(
    (e) => e.name === entry.name && e.size === entry.size,
  );
  if (exists) return;
  setMediaState("entries", (prev) => [...prev, entry]);
}

export function updateMediaEntry(id: string, updates: Partial<MediaEntry>): void {
  setMediaState("entries", (e) => e.id === id, updates);
}

/**
 * Releases a poster URL.
 *
 * Posters are object URLs now that they come from a decoded frame rather than a
 * `<video>` element's `toDataURL`. A data URL needs no cleanup; an object URL
 * holds its blob until it is revoked, so dropping an entry without this leaks the
 * image for the life of the page.
 */
function releasePoster(url: string | undefined): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

/**
 * Drops an entry and everything derived from it.
 *
 * The decorations go too — a filmstrip also holds an object URL. Their persisted
 * copies in OPFS stay: those are keyed by content, so re-importing the same file
 * draws its decorations immediately rather than decoding again.
 */
export function removeMediaEntry(id: string): void {
  releasePoster(mediaState.entries.find((e) => e.id === id)?.thumbnailUrl);
  setMediaState("entries", (prev) => prev.filter((e) => e.id !== id));
  removeFileHandle(id).catch(() => {});
  clearWaveform(id);
  clearFilmstrip(id);
}

export function clearMedia(): void {
  for (const entry of mediaState.entries) releasePoster(entry.thumbnailUrl);
  setMediaState("entries", []);
  setMediaState("selectedIds", []);
  clearAllWaveforms();
  clearAllFilmstrips();
}

export function setDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
  setMediaState("directoryHandle", handle);
}

export function selectMedia(id: string, multi = false): void {
  if (multi) {
    setMediaState("selectedIds", (prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  } else {
    setMediaState("selectedIds", [id]);
  }
}

export function getSelectedEntries(): MediaEntry[] {
  return mediaState.entries.filter((e) => mediaState.selectedIds.includes(e.id));
}

/**
 * Import a file handle into the media pool.
 * Creates the entry immediately, then asynchronously generates thumbnail + metadata.
 */
export async function importFileHandle(
  handle: FileSystemFileHandle,
): Promise<MediaEntry | null> {
  const mediaType = getMediaType(handle.name);
  if (mediaType === "other") return null;

  const file = await getFileFromHandle(handle);

  // The id is derived from the file's bytes, so re-importing the same file
  // resolves to one asset and a saved project can find its media again on
  // another machine. It used to be `media-${Date.now()}`, which could never
  // be resolved twice.
  const id = await computeContentKey(file);

  const existing = mediaState.entries.find((e) => e.id === id);
  if (existing) return existing;

  const entry: MediaEntry = {
    id,
    name: handle.name,
    type: mediaType,
    size: file.size,
    handle,
    importing: true,
  };

  addMediaEntry(entry);
  // Register before returning: the caller may drop this straight onto the
  // timeline, and a clip referencing an unknown asset is rejected.
  syncAssetToDocument(entry);

  saveFileHandle(id, handle).catch(() => {});

  await ingest(entry, file);

  return mediaState.entries.find((e) => e.id === id) ?? entry;
}

/**
 * Opens an entry's file and fills in everything derived from it.
 *
 * Shared by import and restore, which had two copies of this and would have
 * needed a third for the permission re-grant. The copies were identical, which
 * is the only reason the missing engine registration was one bug rather than
 * three subtly different ones.
 *
 * Nothing here throws: an entry that cannot be described still exists in the
 * pool, carrying whatever the probe managed to say about why.
 */
async function ingest(entry: MediaEntry, file: File | Blob): Promise<void> {
  try {
    const [thumbnailUrl, described] = await Promise.all([
      entry.type === "video"
        ? posterFrame(file).then(
            (url) => url ?? undefined,
            () => undefined,
          )
        : entry.type === "image"
          ? generateImageThumbnail(file).catch(() => undefined)
          : Promise.resolve(undefined),
      describeThroughEngine(entry.id, file, entry.type),
    ]);

    updateMediaEntry(entry.id, { ...described, thumbnailUrl, importing: false });
    // The document needs the duration to clamp clips to the source.
    syncAssetToDocument({ ...entry, ...described, thumbnailUrl });
  } catch {
    updateMediaEntry(entry.id, { importing: false });
  }
}

/**
 * Restores media entries from persisted file handles after a reload.
 *
 * **Nothing is deleted here.** This runs on mount, outside any user gesture,
 * where the browser refuses to grant file permission — so a permission check
 * failing here is the normal case, not a signal that the media is gone. The
 * previous version deleted the stored handle on that path, which meant the
 * first reload after a permission lapsed permanently destroyed every media
 * reference in the project.
 *
 * Entries that cannot be read are recorded as needing reconnection, and the
 * user re-grants access from a click.
 */
export async function restoreMedia(): Promise<void> {
  try {
    const saved = await loadAllFileHandles();
    if (saved.length === 0) return;

    const needsPermission: { mediaId: string; handle: FileSystemFileHandle }[] = [];

    for (const { mediaId, handle } of saved) {
      // Skip if already loaded
      if (mediaState.entries.some((e) => e.id === mediaId)) continue;

      const mediaType = getMediaType(handle.name);
      if (mediaType === "other") continue;

      // queryPermission never prompts, so it is safe on startup.
      const ok = await verifyFilePermission(handle).catch(() => false);
      if (!ok) {
        needsPermission.push({ mediaId, handle });
        continue;
      }

      let file: File;
      try {
        file = await getFileFromHandle(handle);
      } catch {
        needsPermission.push({ mediaId, handle });
        continue;
      }

      const entry: MediaEntry = {
        id: mediaId,
        name: handle.name,
        type: mediaType,
        size: file.size,
        handle,
        importing: true,
      };

      addMediaEntry(entry);
      syncAssetToDocument(entry);

      // Not awaited: restore is a loop over every stored handle, and each
      // file's probe and poster should overlap rather than queue.
      void ingest(entry, file);
    }

    setMediaState("pendingPermission", needsPermission);
  } catch (e) {
    console.warn("[media-store] Failed to restore media:", e);
  }
}

/**
 * Re-grants access to media whose permission lapsed.
 *
 * **Must be called from a user gesture** — `requestPermission` is refused
 * outside one, which is exactly why restore no longer attempts it.
 */
export async function reconnectPendingMedia(): Promise<number> {
  const pending = [...mediaState.pendingPermission];
  if (pending.length === 0) return 0;

  const stillPending: typeof pending = [];
  let reconnected = 0;

  for (const item of pending) {
    const granted = await requestFilePermission(item.handle).catch(() => false);
    if (!granted) {
      stillPending.push(item);
      continue;
    }
    try {
      const file = await getFileFromHandle(item.handle);
      const mediaType = getMediaType(item.handle.name);
      const entry: MediaEntry = {
        id: item.mediaId,
        name: item.handle.name,
        type: mediaType,
        size: file.size,
        handle: item.handle,
      };
      addMediaEntry(entry);
      syncAssetToDocument(entry);
      // A re-granted file is as new to the engine as an imported one. Without
      // this the media came back in the pool and stayed blank on the timeline.
      await ingest(entry, file);
      reconnected++;
    } catch {
      stillPending.push(item);
    }
  }

  setMediaState("pendingPermission", stillPending);
  return reconnected;
}

export { mediaState, setMediaState };
