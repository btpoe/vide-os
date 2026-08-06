/**
 * IndexedDB storage for File System Access handles.
 *
 * A `FileSystemFileHandle` is structured-cloneable but not serialisable to
 * JSON, so it lives in IndexedDB keyed by a token that the project file can
 * reference.
 *
 * The one rule here: **a handle is only ever removed by an explicit
 * `forget` call.** The previous implementation deleted handles whenever a
 * permission check failed, and because that check ran on mount — outside any
 * user gesture, where the browser always denies it — the first reload after a
 * permission lapsed permanently destroyed every media reference in the project.
 */

const DB_NAME = "vide-os-handles";
const DB_VERSION = 1;
const STORE = "handles";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open the handle database"));
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Handle store request failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("Handle store transaction aborted"));
  });
}

export async function putHandle(
  token: string,
  handle: FileSystemHandle,
): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, token));
}

export async function getHandle(token: string): Promise<FileSystemHandle | null> {
  const result = await withStore<FileSystemHandle | undefined>("readonly", (store) =>
    store.get(token),
  );
  return result ?? null;
}

/**
 * Removes a stored handle. Call this only when the user has deliberately
 * removed the media — never from a failure path.
 */
export async function deleteHandle(token: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(token));
}

export async function allHandleTokens(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>("readonly", (store) =>
    store.getAllKeys(),
  );
  return keys.map(String);
}

/** Test-only: drops the cached connection so a fresh database can be opened. */
export function resetHandleDb(): void {
  dbPromise = null;
}
