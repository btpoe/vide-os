/**
 * Derived-data cache backed by the Origin Private File System.
 *
 * Thumbnails, waveform pyramids, autosave revisions and (later) proxy media
 * live here. OPFS rather than localStorage because localStorage is a ~5 MB
 * quota that fails silently on overflow — a project with a few keyframed
 * effects can exceed it, and the previous autosave did exactly that with no
 * indication anything had been lost.
 */

import type { Bytes, CacheStore, PlatformCache } from "../types";

const ROOT_DIR = "cache";

async function storeDir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const cacheRoot = await root.getDirectoryHandle(ROOT_DIR, { create: true });
  return cacheRoot.getDirectoryHandle(name, { create: true });
}

/**
 * OPFS filenames must not contain path separators, and cache keys are
 * arbitrary strings (content hashes, but also derived names like
 * `waveform:<key>:level3`).
 */
function encodeKey(key: string): string {
  return encodeURIComponent(key).replace(/\*/g, "%2A");
}

function decodeKey(name: string): string {
  return decodeURIComponent(name);
}

class OpfsStore implements CacheStore {
  constructor(private readonly name: string) {}

  async get(key: string): Promise<Bytes | null> {
    try {
      const dir = await storeDir(this.name);
      const handle = await dir.getFileHandle(encodeKey(key));
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      // Missing entry; a cache miss is not an error.
      return null;
    }
  }

  async set(key: string, value: Bytes | Blob): Promise<void> {
    const dir = await storeDir(this.name);
    const handle = await dir.getFileHandle(encodeKey(key), { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(value);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const dir = await storeDir(this.name);
      await dir.getFileHandle(encodeKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const dir = await storeDir(this.name);
      await dir.removeEntry(encodeKey(key));
    } catch {
      // Already gone.
    }
  }

  async keys(): Promise<string[]> {
    const dir = await storeDir(this.name);
    const out: string[] = [];
    for await (const [name] of (
      dir as FileSystemDirectoryHandle & {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries()) {
      out.push(decodeKey(name));
    }
    return out;
  }

  async clear(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const cacheRoot = await root.getDirectoryHandle(ROOT_DIR, { create: true });
    await cacheRoot.removeEntry(this.name, { recursive: true }).catch(() => undefined);
  }
}

/**
 * In-memory fallback for environments without OPFS (tests in Node, older
 * webviews). Nothing persists, but nothing breaks either.
 */
class MemoryStore implements CacheStore {
  private readonly data = new Map<string, Bytes>();

  get(key: string): Promise<Bytes | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  async set(key: string, value: Bytes | Blob): Promise<void> {
    const bytes =
      value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value;
    this.data.set(key, bytes);
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.data.has(key));
  }

  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.data.keys()]);
  }

  clear(): Promise<void> {
    this.data.clear();
    return Promise.resolve();
  }
}

export function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

const stores = new Map<string, CacheStore>();

export const webCache: PlatformCache = {
  open(name: string): Promise<CacheStore> {
    let store = stores.get(name);
    if (!store) {
      store = opfsAvailable() ? new OpfsStore(name) : new MemoryStore();
      stores.set(name, store);
    }
    return Promise.resolve(store);
  },
};
