import { createEffect, on } from "solid-js";

const PREFIX = "vide-os";

/**
 * Load a value from localStorage. Returns null if not found or parse fails.
 */
export function loadState<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}:${key}`);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[persist] Failed to load "${key}":`, e);
    return null;
  }
}

/**
 * Save a value to localStorage immediately.
 */
export function saveState(key: string, data: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(data));
  } catch (e) {
    console.warn(`[persist] Failed to save "${key}":`, e);
  }
}

/**
 * Clear a persisted key.
 */
export function clearState(key: string): void {
  localStorage.removeItem(`${PREFIX}:${key}`);
}

/**
 * Create a reactive effect that auto-saves a slice of store state
 * to localStorage whenever it changes (debounced).
 *
 * @param key - localStorage key suffix (prefixed with "vide-os:")
 * @param accessor - reactive accessor returning the data to persist
 * @param delayMs - debounce delay in ms (default 500)
 */
export function createPersistEffect(
  key: string,
  accessor: () => unknown,
  delayMs = 500,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  createEffect(
    on(accessor, (value) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(value));
        } catch (e) {
          console.warn(`[persist] Failed to save "${key}":`, e);
        }
      }, delayMs);
    }),
  );
}

/**
 * List all vide-os persisted keys.
 */
export function listPersistedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(`${PREFIX}:`)) {
      keys.push(k.slice(PREFIX.length + 1));
    }
  }
  return keys;
}

/**
 * Clear all vide-os persisted state.
 */
export function clearAllState(): void {
  const keys = listPersistedKeys();
  for (const key of keys) {
    localStorage.removeItem(`${PREFIX}:${key}`);
  }
}
