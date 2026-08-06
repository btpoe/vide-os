import { createStore } from "solid-js/store";
import {
  type MediaType,
  getMediaType,
  getFileFromHandle,
  generateVideoThumbnail,
  generateImageThumbnail,
  getVideoMetadata,
  getAudioDuration,
  formatFileSize,
  saveFileHandle,
  loadAllFileHandles,
  removeFileHandle,
  verifyFilePermission,
} from "@/lib/fs-access";

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
}

const [mediaState, setMediaState] = createStore<MediaStoreState>({
  entries: [],
  directoryHandle: null,
  selectedIds: [],
});

let idCounter = 0;
function nextId(): string {
  return `media-${Date.now()}-${idCounter++}`;
}

export function addMediaEntry(entry: MediaEntry): void {
  // Prevent duplicates by handle name
  const exists = mediaState.entries.some(
    (e) => e.name === entry.name && e.size === entry.size,
  );
  if (exists) return;
  setMediaState("entries", (prev) => [...prev, entry]);
}

export function updateMediaEntry(
  id: string,
  updates: Partial<MediaEntry>,
): void {
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

export function setDirectoryHandle(
  handle: FileSystemDirectoryHandle | null,
): void {
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
  return mediaState.entries.filter((e) =>
    mediaState.selectedIds.includes(e.id),
  );
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
  const id = nextId();

  const entry: MediaEntry = {
    id,
    name: handle.name,
    type: mediaType,
    size: file.size,
    handle,
    importing: true,
  };

  addMediaEntry(entry);

  // Persist file handle to IndexedDB for reload
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
  } catch {
    updateMediaEntry(id, { importing: false });
  }

  return entry;
}

/**
 * Restore media entries from persisted file handles after page reload.
 * Re-imports each handle, regenerating thumbnails and metadata.
 */
export async function restoreMedia(): Promise<void> {
  try {
    const saved = await loadAllFileHandles();
    if (saved.length === 0) return;

    for (const { mediaId, handle } of saved) {
      // Skip if already loaded
      if (mediaState.entries.some((e) => e.id === mediaId)) continue;

      // Verify we still have permission
      const ok = await verifyFilePermission(handle).catch(() => false);
      if (!ok) {
        removeFileHandle(mediaId).catch(() => {});
        continue;
      }

      const mediaType = getMediaType(handle.name);
      if (mediaType === "other") {
        removeFileHandle(mediaId).catch(() => {});
        continue;
      }

      let file: File;
      try {
        file = await getFileFromHandle(handle);
      } catch {
        removeFileHandle(mediaId).catch(() => {});
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

      // Generate thumbnail and metadata in background (don't await — let them load in parallel)
      (async () => {
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
            thumbnailUrl = await generateImageThumbnail(file).catch(
              () => undefined,
            );
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
        } catch {
          updateMediaEntry(mediaId, { importing: false });
        }
      })();
    }
  } catch (e) {
    console.warn("[media-store] Failed to restore media:", e);
  }
}

export { mediaState, setMediaState };
