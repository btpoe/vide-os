# The Platform Seam

Everything host-specific lives behind one interface: file access, persistent
references, the cache directory, and optional transcoding.

The load-bearing method is **`fs.read(ref, range)`**. A byte-range reader is all
a demuxer needs, so once that exists the media engine works identically on every
target.

**No file outside `src/platform/web/` mentions `FileSystemFileHandle`.** That is
enforced by convention and by review, and it is what makes the desktop port a
port rather than a rewrite.

---

## The interface

```ts
// src/platform/types.ts

export interface Platform {
  readonly name: "web" | "tauri";
  fs: PlatformFs;
  cache: PlatformCache;
  transcode?: PlatformTranscode;
  /** Whether this platform can persist file references across reloads. */
  readonly canPersistRefs: boolean;
}
```

Selected at build time, imported as `platform` from `@/platform`.

### File system

```ts
export interface PlatformFs {
  pickOpenFiles(options?: PickFilesOptions): Promise<FileRef[]>;
  pickSaveFile(options?: PickSaveOptions): Promise<FileRef | null>;
  pickDirectory(): Promise<DirRef | null>;

  /** Non-recursive; callers walk if they need depth. */
  readDir(dir: DirRef): Promise<DirEntry[]>;

  /** The primitive the demuxer sits on. Must support random access
   *  without loading the file into memory. */
  read(ref: FileRef, range?: ByteRange): Promise<Bytes>;

  /** For APIs that want a Blob (createImageBitmap, decodeAudioData). */
  readBlob(ref: FileRef, range?: ByteRange): Promise<Blob>;

  write(ref: FileRef, data: Bytes | Blob | ReadableStream<Bytes>): Promise<void>;

  /** Positioned writes. Null when the platform cannot do it. */
  createWritable?(ref: FileRef): Promise<WritableStream<PositionedChunk> | null>;

  stat(ref: FileRef): Promise<{ size: number; mtime?: number }>;

  /** A token that survives a reload, or null. Store it in the project. */
  persistRef(ref: FileRef | DirRef): Promise<string | null>;
  resolveFileRef(token: string): Promise<FileRef | null>;
  resolveDirRef(token: string): Promise<DirRef | null>;
  /** Only ever called deliberately, never on a failure path. */
  forgetRef(token: string): Promise<void>;

  /** Never prompts. Safe to call on startup. */
  queryPermission(ref: FileRef | DirRef): Promise<PermissionState>;
  /** May prompt, so it MUST be called inside a user gesture. */
  requestPermission(ref: FileRef | DirRef): Promise<boolean>;
}
```

A `FileRef` is opaque: `{ id, name, size, mtime?, path? }`. Only the platform
knows what is inside it. `path` is absent on the web.

### Cache

Key/value blob storage for derived data — thumbnails, waveform pyramids,
proxies. On the web this is OPFS.

```ts
export interface PlatformCache {
  open(name: string): Promise<CacheStore>;
}

export interface CacheStore {
  get(key: string): Promise<Bytes | null>;
  set(key: string, value: Bytes | Blob): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}
```

Cache entries are keyed by content key, so a second launch of a project draws
its waveforms and filmstrips without decoding anything.

### Transcode — optional by design

```ts
export interface PlatformTranscode {
  probe(ref: FileRef): Promise<MediaProbeResult>;
  convertToProxy(
    ref: FileRef,
    options: { maxHeight?: number },
    onProgress?: (fraction: number) => void,
  ): Promise<FileRef>;
}
```

**Not implemented on either platform yet.** Being _optional_ is what makes an
ffmpeg fallback a clean add-on rather than a redesign: one call site — "this file
needs conversion, convert it?" — lazy-loads wasm on web or invokes a native
sidecar on desktop.

---

## Two rules that came from real bugs

### `requestPermission` must be inside a user gesture

The browser refuses a permission request outside one. It **always fails**
otherwise — and the code that used to call it from `onMount` treated that failure
as "this handle is dead" and _deleted the stored handle_. The first reload after
a lapsed permission permanently destroyed every media reference in the project.

So the two operations are separate functions with different contracts:
`queryPermission` never prompts and is safe on startup; `requestPermission` may
prompt and must be called from a click.

And note the second half of that lesson, which is more general: fixing a bug
behind a new abstraction does not fix the call sites that bypass it. The same
defect had a second home in a helper that called the browser API directly.

### Positioned writes, not append-only

MP4 patches its header once the sizes are known, so a muxer has to seek
backwards. And a feature-length 4K export cannot be held in memory until it is
complete.

`createWritable` therefore returns a `WritableStream<PositionedChunk>` — the
shape `FileSystemWritableFileStream` already accepts:

```ts
interface PositionedChunk {
  type: "write";
  data: Bytes;
  position: number;
}
```

An append-only sink would produce a corrupt file that still looks plausible,
which is why the export test reassembles a sparse file from the chunks and
demuxes the result.

### A note on `Bytes`

```ts
export type Bytes = Uint8Array<ArrayBuffer>;
```

Pinned to a plain `ArrayBuffer`, not `ArrayBufferLike`. A `SharedArrayBuffer`-
backed view is not a valid `BlobPart` or filesystem write chunk. Nothing here is
ever shared-backed, and saying so keeps the conversions at the edges rather than
requiring a cast at every write.

---

## Implementing a new platform

Two directories:

```
src/platform/types.ts      the interface (do not change lightly)
src/platform/web/          File System Access + OPFS + IndexedDB
src/platform/index.ts      build-time selection
```

To add one — a Tauri build, an Electron build, a Node-based headless renderer —
implement `Platform` and wire it into `index.ts`. Nothing above the seam should
need to change.

The seam has been tested by extension already: adding positioned writes for the
Phase 5 streaming export path was a clean addition rather than a redesign, and
`read(ref, range)` has since absorbed a demuxer, a relink flow and a streaming
muxer without changing shape.

**Tauri v2 is the next planned implementation** — `src-tauri/` plus
`src/platform/tauri/`, with `tauri-plugin-{dialog,fs,shell}` and an ffmpeg
sidecar behind `transcode`. See the [Roadmap](../roadmap.md).

---

## Related: the media engine

The media engine sits directly on top of the seam and is worth knowing about if
you are touching either.

```
AssetRegistry   contentKey → one demuxer + sync-sample index (shared, cheap)
ClipDecoder     one per active clip, ring of ~0.5 s lookahead
DecoderPool     budgeted activation, LRU eviction
FrameCache      refcounted VideoFrame LRU with a byte budget
```

The unit of decode is **a clip on the timeline, not a file on disk**. Two clips of
one source get two decoders and never interfere. (They used to share one
`<video>` element per file, so a split clip's two halves fought over
`currentTime` and the last seek won.)

Three ways to ask for a frame:

| Call       | Waits? | Used by                                                                                       |
| ---------- | ------ | --------------------------------------------------------------------------------------------- |
| `getExact` | yes    | Export — the only one that can be deterministic                                               |
| `tryGet`   | never  | Preview — lets the loop render at a steady rate and repeat a frame when the decoder is behind |
| nearest    | never  | Scrubbing; reports `exact: false` so callers can tell                                         |

**Frames are refcounted and the balance is measured.** `openFrameCount()` tracks
created-minus-closed and is asserted in browser tests. Hoping for `.close()`
discipline does not work — `VideoFrame` holds memory the garbage collector will
not reclaim, and exhausting decoders fails silently mid-edit. Note what the
counter means: a _cached_ frame is legitimately open, so zero is only expected
once whatever owns the cache has been disposed. Export owns its own decoder pool
partly for that reason, and partly so a long export cannot evict the frames the
editor is showing.

**The engine deliberately does not run in a worker.** `VideoDecoder` already does
its work in the browser's media process, so moving the engine would marshal
`VideoFrame`s across a boundary on the preview's hot path in order to relocate
the thin JS around it. Waveform analysis _does_ run in a worker, because it is
hundreds of millions of samples of arithmetic in JS. That distinction —
measured rather than assumed — is the whole of the worker decision. The engine
facade is async anyway, as insurance against that judgement changing.

Source: [`src/platform/`](../../src/platform/),
[`src/media/`](../../src/media/).

---

**See also:** [The Document](document.md) · [Roadmap](../roadmap.md)
