import { createSignal } from "solid-js";
import { loadState, saveState } from "@/lib/persist";
import { platform } from "@/platform";
import type { FileRef } from "@/platform/types";

/**
 * Recently opened projects.
 *
 * Entries hold a *token* from `platform.fs.persistRef`, not a path: the web
 * platform has no paths, and a `FileSystemFileHandle` only survives a reload
 * if it has been put somewhere that survives a reload. Resolving a token can
 * fail — the file may have been moved or the grant withdrawn — so opening from
 * this list has to handle a miss rather than assume.
 *
 * Small enough for localStorage, which is where UI preferences live. The
 * document itself does not go there; that lesson cost an autosave.
 */

const KEY = "recent-projects";
const MAX_ENTRIES = 10;

export interface RecentProject {
  name: string;
  /** From `platform.fs.persistRef`; null when this platform cannot persist. */
  token: string | null;
  openedAt: number;
}

const [recentProjects, setRecentProjects] = createSignal<RecentProject[]>(
  loadState<RecentProject[]>(KEY) ?? [],
);

export { recentProjects };

/**
 * Records a project as opened or saved.
 *
 * Keyed by token so reopening the same file moves it to the top rather than
 * adding a second row. An entry with no token — a file the platform cannot
 * remember — is still listed, because seeing what you worked on is useful even
 * when it cannot be reopened in one click.
 */
export async function rememberProject(
  name: string,
  ref: FileRef | null,
): Promise<void> {
  const token = ref ? await platform.fs.persistRef(ref) : null;
  const entry: RecentProject = { name, token, openedAt: Date.now() };

  const rest = recentProjects().filter((existing) =>
    token !== null ? existing.token !== token : existing.name !== name,
  );

  const next = [entry, ...rest].slice(0, MAX_ENTRIES);
  setRecentProjects(next);
  saveState(KEY, next);
}

/** Resolves an entry to a file, or null when it can no longer be reached. */
export async function resolveRecent(entry: RecentProject): Promise<FileRef | null> {
  if (!entry.token) return null;
  try {
    return await platform.fs.resolveFileRef(entry.token);
  } catch {
    return null;
  }
}

/** Drops an entry, for one that no longer resolves. */
export function forgetRecent(entry: RecentProject): void {
  const next = recentProjects().filter((existing) => existing !== entry);
  setRecentProjects(next);
  saveState(KEY, next);
}

export function clearRecentProjects(): void {
  setRecentProjects([]);
  saveState(KEY, []);
}
