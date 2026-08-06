/**
 * The boundary between the editor and whatever it is running on.
 *
 * Everything platform-specific lives behind this interface: file access,
 * persistent handles, the cache directory, optional transcoding. The web
 * implementation uses File System Access + OPFS + IndexedDB; a desktop
 * implementation would use native filesystem APIs and a bundled ffmpeg.
 *
 * The load-bearing method is `fs.read(ref, range)`. A byte-range reader is all
 * a demuxer needs, so once that exists the media engine works identically on
 * every target. After this seam is adopted, no file outside `platform/web/`
 * should mention `FileSystemFileHandle`.
 */

/**
 * Byte payloads, pinned to a plain ArrayBuffer.
 *
 * A bare `Uint8Array` is generic over `ArrayBufferLike`, which includes
 * `SharedArrayBuffer` — and a shared-backed view is not a valid `BlobPart` or
 * filesystem write chunk. Nothing here is ever shared-backed, so saying so
 * keeps the conversions at the edges rather than casting at every write.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** An opaque reference to a file. Only the platform knows what's inside. */
export interface FileRef {
  /** Stable within a session; not persistent. Use `persistRef` for that. */
  id: string;
  name: string;
  size: number;
  /** Milliseconds since epoch, when the platform can supply it. */
  mtime?: number;
  /** Absolute path, on platforms that expose one. The web does not. */
  path?: string;
}

export interface DirRef {
  id: string;
  name: string;
  path?: string;
}

export interface ByteRange {
  offset: number;
  length: number;
}

export type PermissionState = "granted" | "prompt" | "denied";

export interface PickFilesOptions {
  multiple?: boolean;
  /** Description plus extensions, e.g. `{ description: "Video", extensions: [".mp4"] }`. */
  accept?: { description: string; extensions: string[] }[];
}

export interface PickSaveOptions {
  suggestedName?: string;
  accept?: { description: string; extensions: string[] }[];
}

export interface DirEntry {
  name: string;
  kind: "file" | "directory";
  /** Path relative to the directory the walk started from. */
  relPath: string;
  ref: FileRef | DirRef;
}

export interface PlatformFs {
  pickOpenFiles(options?: PickFilesOptions): Promise<FileRef[]>;
  pickSaveFile(options?: PickSaveOptions): Promise<FileRef | null>;
  pickDirectory(): Promise<DirRef | null>;

  /** Lists a directory. Non-recursive; callers walk if they need depth. */
  readDir(dir: DirRef): Promise<DirEntry[]>;

  /**
   * Reads bytes. Omitting `range` reads the whole file.
   *
   * This is the primitive the demuxer sits on, so it must support random
   * access without loading the file into memory.
   */
  read(ref: FileRef, range?: ByteRange): Promise<Bytes>;

  /** Reads as a Blob, for APIs that want one (decodeAudioData, createImageBitmap). */
  readBlob(ref: FileRef, range?: ByteRange): Promise<Blob>;

  write(ref: FileRef, data: Bytes | Blob | ReadableStream<Bytes>): Promise<void>;

  stat(ref: FileRef): Promise<{ size: number; mtime?: number }>;

  /**
   * Returns a token that survives a reload, or null if this platform cannot
   * persist a reference to this file. Store the token in the project.
   */
  persistRef(ref: FileRef | DirRef): Promise<string | null>;

  /** Resolves a token from `persistRef`. Null when the file is gone. */
  resolveFileRef(token: string): Promise<FileRef | null>;
  resolveDirRef(token: string): Promise<DirRef | null>;

  /** Drops a stored token. Only ever called deliberately, never on a failure path. */
  forgetRef(token: string): Promise<void>;

  /** Never prompts. Safe to call on startup. */
  queryPermission(ref: FileRef | DirRef): Promise<PermissionState>;

  /**
   * May prompt, so it MUST be called inside a user gesture.
   *
   * Calling this outside one is what silently destroyed media references: it
   * always failed, and the failure path deleted the stored handle.
   */
  requestPermission(ref: FileRef | DirRef): Promise<boolean>;
}

/** Key/value blob storage for derived data — thumbnails, waveforms, proxies. */
export interface CacheStore {
  get(key: string): Promise<Bytes | null>;
  set(key: string, value: Bytes | Blob): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export interface PlatformCache {
  open(name: string): Promise<CacheStore>;
}

export interface MediaProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

/**
 * Optional transcoding. Absent on web until ffmpeg.wasm is opted into, and
 * backed by a native sidecar on desktop. Being optional is what lets one call
 * site — "this file needs conversion, convert it?" — serve both.
 */
export interface PlatformTranscode {
  probe(ref: FileRef): Promise<MediaProbeResult>;
  convertToProxy(
    ref: FileRef,
    options: { maxHeight?: number },
    onProgress?: (fraction: number) => void,
  ): Promise<FileRef>;
}

export interface Platform {
  readonly name: "web" | "tauri";
  fs: PlatformFs;
  cache: PlatformCache;
  transcode?: PlatformTranscode;
  /** Whether this platform can persist file references across reloads. */
  readonly canPersistRefs: boolean;
}
