/**
 * File System Access implementation of `PlatformFs`.
 *
 * This is the only place in the codebase that should mention
 * `FileSystemFileHandle`. Everything above it works in terms of `FileRef`.
 */

import type {
  ByteRange,
  Bytes,
  DirEntry,
  DirRef,
  FileRef,
  PermissionState,
  PickFilesOptions,
  PickSaveOptions,
  PlatformFs,
  PositionedChunk,
} from "../types";
import { deleteHandle, getHandle, putHandle } from "./handles";

/**
 * Session-scoped map from `FileRef.id` to the underlying handle. Refs are
 * plain data so they can cross a worker boundary; the handle stays here.
 */
const handles = new Map<string, FileSystemHandle>();

/**
 * Files that arrived without a handle — drag-and-drop, `<input type=file>`.
 * They work for the session but cannot be persisted, so a project referencing
 * one needs a relink after reload.
 */
const looseFiles = new Map<string, File>();

let refCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}:${++refCounter}`;
}

async function fileRefFromHandle(handle: FileSystemFileHandle): Promise<FileRef> {
  const id = nextId("file");
  handles.set(id, handle);
  // getFile() needs read permission; without it we still return a usable ref
  // so the caller can prompt, rather than failing the import outright.
  try {
    const file = await handle.getFile();
    return { id, name: handle.name, size: file.size, mtime: file.lastModified };
  } catch {
    return { id, name: handle.name, size: 0 };
  }
}

function dirRefFromHandle(handle: FileSystemDirectoryHandle): DirRef {
  const id = nextId("dir");
  handles.set(id, handle);
  return { id, name: handle.name };
}

function requireHandle(ref: FileRef | DirRef): FileSystemHandle {
  const handle = handles.get(ref.id);
  if (!handle) {
    throw new Error(
      `No handle for ${ref.id}. The reference is from a previous session — resolve it through resolveFileRef first.`,
    );
  }
  return handle;
}

function asFileHandle(ref: FileRef): FileSystemFileHandle {
  const handle = requireHandle(ref);
  if (handle.kind !== "file") throw new Error(`${ref.name} is a directory, not a file`);
  return handle as FileSystemFileHandle;
}

function toAcceptMap(
  accept: { description: string; extensions: string[] }[] | undefined,
) {
  return accept?.map((entry) => ({
    description: entry.description,
    accept: { "*/*": entry.extensions },
  }));
}

export const webFs: PlatformFs = {
  async pickOpenFiles(options: PickFilesOptions = {}): Promise<FileRef[]> {
    try {
      const picked = await window.showOpenFilePicker({
        multiple: options.multiple ?? false,
        types: toAcceptMap(options.accept),
      });
      return Promise.all(picked.map(fileRefFromHandle));
    } catch {
      return []; // user cancelled
    }
  },

  async pickSaveFile(options: PickSaveOptions = {}): Promise<FileRef | null> {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: options.suggestedName,
        types: toAcceptMap(options.accept),
      });
      return await fileRefFromHandle(handle);
    } catch {
      return null;
    }
  },

  async pickDirectory(): Promise<DirRef | null> {
    try {
      return dirRefFromHandle(await window.showDirectoryPicker({ mode: "read" }));
    } catch {
      return null;
    }
  },

  async readDir(dir: DirRef): Promise<DirEntry[]> {
    const handle = requireHandle(dir) as FileSystemDirectoryHandle;
    const entries: DirEntry[] = [];

    for await (const child of handle.values()) {
      entries.push({
        name: child.name,
        kind: child.kind,
        relPath: child.name,
        ref:
          child.kind === "file"
            ? await fileRefFromHandle(child as FileSystemFileHandle)
            : dirRefFromHandle(child as FileSystemDirectoryHandle),
      });
    }

    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  async read(ref: FileRef, range?: ByteRange): Promise<Bytes> {
    const blob = await webFs.readBlob(ref, range);
    return new Uint8Array(await blob.arrayBuffer());
  },

  async readBlob(ref: FileRef, range?: ByteRange): Promise<Blob> {
    const loose = looseFiles.get(ref.id);
    const file = loose ?? (await asFileHandle(ref).getFile());
    // Blob.slice is lazy, so a range read does not pull the whole file into
    // memory — which is what makes demuxing a 40GB file viable.
    return range ? file.slice(range.offset, range.offset + range.length) : file;
  },

  async write(ref: FileRef, data: Bytes | Blob | ReadableStream<Bytes>): Promise<void> {
    const writable = await asFileHandle(ref).createWritable();
    try {
      if (data instanceof ReadableStream) {
        // Streamed so a large export never has to exist as one Blob.
        await data.pipeTo(writable, { preventClose: true });
        await writable.close();
      } else {
        // Wrapped in a Blob rather than written directly: a Uint8Array over a
        // SharedArrayBuffer is not a valid write chunk, and the distinction is
        // not worth propagating through the platform signature.
        await writable.write(data instanceof Blob ? data : new Blob([data]));
        await writable.close();
      }
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  },

  async createWritable(ref: FileRef): Promise<WritableStream<PositionedChunk> | null> {
    const handle = asFileHandle(ref);
    if (typeof handle.createWritable !== "function") return null;

    const stream = await handle.createWritable();
    // Adapted rather than returned directly: `FileSystemWritableFileStream` is
    // a WritableStream of a wider union, and narrowing it here keeps the
    // positioned-chunk contract visible at the seam.
    return new WritableStream<PositionedChunk>({
      async write(chunk) {
        await stream.write({
          type: "write",
          position: chunk.position,
          data: chunk.data,
        });
      },
      async close() {
        await stream.close();
      },
      async abort() {
        await stream.abort().catch(() => undefined);
      },
    });
  },

  async stat(ref: FileRef): Promise<{ size: number; mtime?: number }> {
    const loose = looseFiles.get(ref.id);
    const file = loose ?? (await asFileHandle(ref).getFile());
    return { size: file.size, mtime: file.lastModified };
  },

  async persistRef(ref: FileRef | DirRef): Promise<string | null> {
    // A loose File has no handle, so there is nothing to persist. Returning
    // null lets the caller record the asset as needing a relink rather than
    // pretending it will come back.
    const handle = handles.get(ref.id);
    if (!handle) return null;
    const token = `${handle.kind}:${crypto.randomUUID()}`;
    await putHandle(token, handle);
    return token;
  },

  async resolveFileRef(token: string): Promise<FileRef | null> {
    const handle = await getHandle(token);
    if (!handle || handle.kind !== "file") return null;
    return fileRefFromHandle(handle as FileSystemFileHandle);
  },

  async resolveDirRef(token: string): Promise<DirRef | null> {
    const handle = await getHandle(token);
    if (!handle || handle.kind !== "directory") return null;
    return dirRefFromHandle(handle as FileSystemDirectoryHandle);
  },

  async forgetRef(token: string): Promise<void> {
    await deleteHandle(token);
  },

  async queryPermission(ref: FileRef | DirRef): Promise<PermissionState> {
    const handle = handles.get(ref.id);
    if (!handle) return "denied";
    // queryPermission never prompts, so this is safe on startup — unlike
    // requestPermission, which needs a user gesture and used to be called
    // from onMount, where it always failed.
    const query = (
      handle as FileSystemHandle & {
        queryPermission?: (
          d: FileSystemHandlePermissionDescriptor,
        ) => Promise<PermissionState>;
      }
    ).queryPermission;
    if (!query) return "granted";
    try {
      return await query.call(handle, { mode: "read" });
    } catch {
      return "denied";
    }
  },

  async requestPermission(ref: FileRef | DirRef): Promise<boolean> {
    const handle = handles.get(ref.id);
    if (!handle) return false;
    const request = (
      handle as FileSystemHandle & {
        requestPermission?: (
          d: FileSystemHandlePermissionDescriptor,
        ) => Promise<PermissionState>;
      }
    ).requestPermission;
    if (!request) return true;
    try {
      return (await request.call(handle, { mode: "read" })) === "granted";
    } catch {
      // Thrown when called outside a user gesture. The caller is at fault;
      // crucially, nothing is deleted as a result.
      return false;
    }
  },
};

/** Wraps a plain `File` (drag-and-drop, `<input type=file>`) as a FileRef. */
export function fileRefFromFile(file: File): FileRef {
  const id = nextId("loose");
  looseFiles.set(id, file);
  return { id, name: file.name, size: file.size, mtime: file.lastModified };
}

/** Registers an already-open handle, for code paths that obtained one directly. */
export async function fileRefFromHandleDirect(
  handle: FileSystemFileHandle,
): Promise<FileRef> {
  return fileRefFromHandle(handle);
}

/** Test-only: clears the session ref tables. */
export function resetWebFs(): void {
  handles.clear();
  looseFiles.clear();
  refCounter = 0;
}
