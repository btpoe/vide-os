/**
 * File System Access API helpers
 * Chromium-only — no fallbacks for Firefox/Safari
 */

// ── Media type detection ──────────────────────────────────────────────

const VIDEO_EXTS = new Set([
  "mp4",
  "mov",
  "avi",
  "webm",
  "mkv",
  "m4v",
  "ts",
  "mts",
  "flv",
  "wmv",
]);
const AUDIO_EXTS = new Set(["mp3", "wav", "aac", "ogg", "flac", "m4a", "wma", "opus"]);
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "tiff",
  "ico",
  "heic",
]);

/**
 * Extensions the browser can realistically decode. The sets above classify a
 * file for display; this one says whether we can actually play it.
 *
 * They used to be the same thing, which meant a `.avi` or `.mkv` imported with
 * a nice icon and a duration, then rendered black forever with the decode
 * rejection swallowed. Classification and capability are separate questions.
 *
 * This is still an extension heuristic — a real per-track `canDecode()` probe
 * replaces it when the media engine lands. Codec-in-container mismatches
 * (HEVC in MP4, ProRes in MOV) are not detectable from the name alone.
 */
const LIKELY_DECODABLE_EXTS = new Set([
  // Containers browsers demux, holding codecs they decode.
  "mp4",
  "m4v",
  "mov",
  "webm",
  // Audio.
  "mp3",
  "wav",
  "aac",
  "ogg",
  "flac",
  "m4a",
  "opus",
  // Images.
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

export type MediaType = "video" | "audio" | "image" | "other";
export type DecodeSupport = "likely" | "needs-conversion";

export function getMediaType(filename: string): MediaType {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "other";
}

/**
 * Whether this file is worth handing to a decoder. Callers should surface
 * `needs-conversion` to the user rather than importing and failing silently.
 */
export function getDecodeSupport(filename: string): DecodeSupport {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return LIKELY_DECODABLE_EXTS.has(ext) ? "likely" : "needs-conversion";
}

export function isMediaFile(filename: string): boolean {
  return getMediaType(filename) !== "other";
}

/**
 * `FileSystemHandle` is a base class in lib.dom, not a discriminated union, so
 * checking `.kind === "file"` does not narrow it on its own.
 */
export function isFileHandle(handle: FileSystemHandle): handle is FileSystemFileHandle {
  return handle.kind === "file";
}

export function isDirectoryHandle(
  handle: FileSystemHandle,
): handle is FileSystemDirectoryHandle {
  return handle.kind === "directory";
}

export function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

// ── File icons ────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, string> = {
  mp4: "🎬",
  mov: "🎬",
  avi: "🎬",
  webm: "🎬",
  mkv: "🎬",
  m4v: "🎬",
  ts: "🎬",
  mts: "🎬",
  flv: "🎬",
  wmv: "🎬",
  mp3: "🎵",
  wav: "🎵",
  aac: "🎵",
  ogg: "🎵",
  flac: "🎵",
  m4a: "🎵",
  wma: "🎵",
  opus: "🎵",
  png: "🖼️",
  jpg: "🖼️",
  jpeg: "🖼️",
  gif: "🖼️",
  webp: "🖼️",
  svg: "🖼️",
  bmp: "🖼️",
  tiff: "🖼️",
  ico: "🖼️",
  heic: "🖼️",
  json: "📋",
  txt: "📝",
  md: "📝",
  html: "🌐",
  css: "🎨",
  js: "⚙️",
};

export function getFileIcon(filename: string): string {
  const ext = getExtension(filename);
  return FILE_ICONS[ext] || "📄";
}

// ── Directory reading ─────────────────────────────────────────────────

export interface FSEntry {
  name: string;
  kind: "file" | "directory";
  handle: FileSystemHandle;
  path: string; // relative path from root
  size?: number;
  mediaType?: MediaType;
}

export async function readDirectory(
  dirHandle: FileSystemDirectoryHandle,
  parentPath = "",
): Promise<FSEntry[]> {
  const entries: FSEntry[] = [];
  for await (const entry of dirHandle.values()) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const fsEntry: FSEntry = {
      name: entry.name,
      kind: entry.kind,
      handle: entry,
      path,
    };
    if (entry.kind === "file") {
      fsEntry.mediaType = getMediaType(entry.name);
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        fsEntry.size = file.size;
      } catch {
        // Permission may not be granted yet
      }
    }
    entries.push(fsEntry);
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Open directory picker ─────────────────────────────────────────────

export async function openDirectoryPicker(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: "read" });
  } catch {
    return null; // user cancelled
  }
}

// ── Get file from handle ──────────────────────────────────────────────

export async function getFileFromHandle(handle: FileSystemFileHandle): Promise<File> {
  return handle.getFile();
}

export async function getObjectURL(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return URL.createObjectURL(file);
}

// ── Thumbnail generation ──────────────────────────────────────────────

export function generateVideoThumbnail(file: File, seekTime = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = () => {
      // Seek to the requested time or 10% of duration
      video.currentTime = Math.min(seekTime, video.duration * 0.1 || seekTime);
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = Math.round(192 * (video.videoHeight / video.videoWidth)) || 108;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video for thumbnail"));
    };
  });
}

export function generateImageThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = Math.round(192 * (img.height / img.width)) || 108;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for thumbnail"));
    };
  });
}

// ── Video metadata extraction ─────────────────────────────────────────

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export function getVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = () => {
      // Detect audio tracks
      const v = video as any;
      let hasAudio: boolean;
      if (typeof v.mozHasAudio === "boolean") {
        hasAudio = v.mozHasAudio;
      } else if (typeof v.webkitAudioDecodedByteCount === "number") {
        hasAudio = v.webkitAudioDecodedByteCount > 0;
      } else if (v.audioTracks && typeof v.audioTracks.length === "number") {
        hasAudio = v.audioTracks.length > 0;
      } else {
        // Assume video files have audio unless proven otherwise
        hasAudio = true;
      }
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        hasAudio,
      });
      URL.revokeObjectURL(url);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video metadata"));
    };
  });
}

export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const url = URL.createObjectURL(file);
    audio.src = url;

    audio.onloadedmetadata = () => {
      resolve(audio.duration);
      URL.revokeObjectURL(url);
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load audio metadata"));
    };
  });
}

// ── IndexedDB for persisting directory handles ────────────────────────

const DB_NAME = "vide-os";
const DB_VERSION = 1;
const STORE_NAME = "handles";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function saveDirectoryHandle(
  key: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

export async function loadDirectoryHandle(
  key: string,
): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts = { mode: "read" as const };
  if ((await (handle as any).queryPermission(opts)) === "granted") return true;
  if ((await (handle as any).requestPermission(opts)) === "granted") return true;
  return false;
}

// ── IndexedDB for persisting file handles (media) ─────────────────────

export async function saveFileHandle(
  mediaId: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, `media:${mediaId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

export async function loadAllFileHandles(): Promise<
  { mediaId: string; handle: FileSystemFileHandle }[]
> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    const results: { mediaId: string; handle: FileSystemFileHandle }[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const key = cursor.key as string;
        if (typeof key === "string" && key.startsWith("media:")) {
          results.push({
            mediaId: key.slice("media:".length),
            handle: cursor.value as FileSystemFileHandle,
          });
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function removeFileHandle(mediaId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(`media:${mediaId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

type PermissionCapable = FileSystemHandle & {
  queryPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
};

/**
 * Whether we already hold read permission. Never prompts, so this is safe on
 * startup.
 *
 * This used to fall through to `requestPermission`, which the browser refuses
 * outside a user gesture — so calling it from `onMount` always failed, and the
 * caller treated that failure as "the media is gone".
 */
export async function verifyFilePermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  const query = (handle as PermissionCapable).queryPermission;
  if (!query) return true;
  try {
    return (await query.call(handle, { mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

/**
 * Asks for read permission. **Must be called from a user gesture** — the
 * browser rejects it otherwise.
 */
export async function requestFilePermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  if (await verifyFilePermission(handle)) return true;
  const request = (handle as PermissionCapable).requestPermission;
  if (!request) return true;
  try {
    return (await request.call(handle, { mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

// ── Format helpers ────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
