import { createStore } from "solid-js/store";
import {
  type MediaType,
  getMediaType,
  getDecodeSupport,
  getFileFromHandle,
  generateVideoThumbnail,
  generateImageThumbnail,
  getVideoMetadata,
  getAudioDuration,
  saveFileHandle,
  loadAllFileHandles,
  removeFileHandle,
  verifyFilePermission,
  requestFilePermission,
} from "@/lib/fs-access";
import { computeContentKey } from "@/model/ids";
import { registerAsset } from "@/stores/project-store";
import type { Asset, AssetKind } from "@/model/doc";

export interface MediaEntry {
  id: string;
  name: string;
  type: MediaType;
  size: number;
  handle: FileSystemFileHandle;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
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

  if (getDecodeSupport(entry.name) === "needs-conversion") {
    asset.problem = {
      kind: "unsupported-codec",
      detail: `${entry.name.split(".").pop()?.toUpperCase() ?? "This format"} is not decodable in the browser. Convert it to MP4 or WebM first.`,
    };
  }

  registerAsset(asset);
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

export function removeMediaEntry(id: string): void {
  setMediaState("entries", (prev) => prev.filter((e) => e.id !== id));
  removeFileHandle(id).catch(() => {});
}

export function clearMedia(): void {
  setMediaState("entries", []);
  setMediaState("selectedIds", []);
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

  // Generate thumbnail and metadata in background
  try {
    let thumbnailUrl: string | undefined;
    let duration: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let hasAudio: boolean | undefined;

    if (mediaType === "video") {
      const [thumb, meta] = await Promise.all([
        generateVideoThumbnail(file).catch(() => undefined),
        getVideoMetadata(file).catch(() => undefined),
      ]);
      thumbnailUrl = thumb;
      if (meta) {
        duration = meta.duration;
        width = meta.width;
        height = meta.height;
      }
      hasAudio = meta?.hasAudio ?? true;
    } else if (mediaType === "image") {
      thumbnailUrl = await generateImageThumbnail(file).catch(() => undefined);
    } else if (mediaType === "audio") {
      duration = await getAudioDuration(file).catch(() => undefined);
      hasAudio = true;
    }

    updateMediaEntry(id, {
      thumbnailUrl,
      duration,
      width,
      height,
      hasAudio,
      importing: false,
    });
    // The document needs the duration to clamp clips to the source.
    syncAssetToDocument({ ...entry, duration, width, height, hasAudio });
  } catch {
    updateMediaEntry(id, { importing: false });
  }

  return mediaState.entries.find((e) => e.id === id) ?? entry;
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

      // Generate thumbnail and metadata in background (don't await — let them load in parallel)
      void (async () => {
        try {
          let thumbnailUrl: string | undefined;
          let duration: number | undefined;
          let width: number | undefined;
          let height: number | undefined;
          let hasAudio: boolean | undefined;

          if (mediaType === "video") {
            const [thumb, meta] = await Promise.all([
              generateVideoThumbnail(file).catch(() => undefined),
              getVideoMetadata(file).catch(() => undefined),
            ]);
            thumbnailUrl = thumb;
            if (meta) {
              duration = meta.duration;
              width = meta.width;
              height = meta.height;
            }
            hasAudio = meta?.hasAudio ?? true;
          } else if (mediaType === "image") {
            thumbnailUrl = await generateImageThumbnail(file).catch(() => undefined);
          } else if (mediaType === "audio") {
            duration = await getAudioDuration(file).catch(() => undefined);
            hasAudio = true;
          }

          updateMediaEntry(mediaId, {
            thumbnailUrl,
            duration,
            width,
            height,
            hasAudio,
            importing: false,
          });
          syncAssetToDocument({ ...entry, duration, width, height, hasAudio });
        } catch {
          updateMediaEntry(mediaId, { importing: false });
        }
      })();
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
      reconnected++;
    } catch {
      stillPending.push(item);
    }
  }

  setMediaState("pendingPermission", stillPending);
  return reconnected;
}

export { mediaState, setMediaState };
