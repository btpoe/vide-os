/**
 * Autosave, revisions and crash recovery.
 *
 * The document used to go to localStorage on a debounce. localStorage is a
 * ~5 MB quota that throws on overflow and was caught and warned to a console
 * nobody was reading, so a project with a few keyframed effects silently
 * stopped being saved. OPFS has no such ceiling.
 *
 * Three things are kept:
 *
 * - **Revisions.** The last `MAX_REVISIONS` autosaves, so a recovery can go
 *   back further than the most recent one — which matters when the thing you
 *   want to undo is what caused the crash.
 * - **A session flag.** Written when the editor starts and removed on a clean
 *   unload. Finding it still there at launch is how a crash is detected;
 *   there is no other signal a page gets.
 * - **A clean marker.** Set when the project is explicitly saved to a file, so
 *   recovery can say whether the autosave is actually newer than the file.
 */

import type { ProjectDoc } from "@/model/doc";
import { serializeDoc, parseDoc } from "@/model/io";
import { platform } from "@/platform";
import type { CacheStore } from "@/platform/types";

const STORE_NAME = "autosave";
const SESSION_KEY = "session-open";
const CLEAN_KEY = "last-clean-save";
const REVISION_PREFIX = "rev-";

/** How many autosaves to keep. Ten covers a few minutes of work. */
export const MAX_REVISIONS = 10;

/** How long after the last edit to write. Long enough not to write mid-drag. */
export const AUTOSAVE_DELAY_MS = 2000;

export interface Revision {
  key: string;
  savedAt: number;
  projectName: string;
  bytes: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let store: CacheStore | null = null;
async function open(): Promise<CacheStore | null> {
  if (store) return store;
  try {
    store = await platform.cache.open(STORE_NAME);
    return store;
  } catch {
    // No OPFS — a private window in some browsers. Autosave is a safety net,
    // so losing it must not stop the editor from working.
    return null;
  }
}

interface RevisionEnvelope {
  savedAt: number;
  projectName: string;
  doc: string;
}

/** Writes a revision and drops the oldest beyond the limit. */
export async function writeRevision(doc: ProjectDoc): Promise<void> {
  const cache = await open();
  if (!cache) return;

  const savedAt = Date.now();
  const envelope: RevisionEnvelope = {
    savedAt,
    projectName: doc.name,
    doc: serializeDoc(doc),
  };

  await cache.set(
    `${REVISION_PREFIX}${savedAt}`,
    encoder.encode(JSON.stringify(envelope)),
  );
  await prune(cache);
}

/** Newest first. */
export async function listRevisions(): Promise<Revision[]> {
  const cache = await open();
  if (!cache) return [];

  const keys = (await cache.keys()).filter((key) => key.startsWith(REVISION_PREFIX));
  const revisions: Revision[] = [];

  for (const key of keys) {
    const bytes = await cache.get(key);
    if (!bytes) continue;
    try {
      const envelope = JSON.parse(decoder.decode(bytes)) as RevisionEnvelope;
      revisions.push({
        key,
        savedAt: envelope.savedAt,
        projectName: envelope.projectName,
        bytes: bytes.byteLength,
      });
    } catch {
      // A half-written revision from a crash mid-write. Skip it rather than
      // letting one bad entry hide the good ones.
      continue;
    }
  }

  return revisions.sort((a, b) => b.savedAt - a.savedAt);
}

/** Reads one back, migrating it if it was written by an older version. */
export async function readRevision(key: string): Promise<ProjectDoc | null> {
  const cache = await open();
  if (!cache) return null;

  const bytes = await cache.get(key);
  if (!bytes) return null;

  try {
    const envelope = JSON.parse(decoder.decode(bytes)) as RevisionEnvelope;
    const result = parseDoc(envelope.doc);
    return result.doc;
  } catch {
    return null;
  }
}

async function prune(cache: CacheStore): Promise<void> {
  const keys = (await cache.keys())
    .filter((key) => key.startsWith(REVISION_PREFIX))
    // The key carries its timestamp, so pruning needs no reads.
    .sort(
      (a, b) =>
        Number(b.slice(REVISION_PREFIX.length)) -
        Number(a.slice(REVISION_PREFIX.length)),
    );

  for (const key of keys.slice(MAX_REVISIONS)) {
    await cache.delete(key);
  }
}

// ── Session tracking ──────────────────────────────────────────────────

/**
 * Marks a session as open.
 *
 * Call once at startup, *after* reading `wasUnclean` — otherwise the flag this
 * session writes is the one it reads back.
 */
export async function markSessionOpen(): Promise<void> {
  const cache = await open();
  await cache?.set(SESSION_KEY, encoder.encode(String(Date.now())));
}

/** Marks a clean exit. Best-effort: an unload handler may not finish. */
export async function markSessionClosed(): Promise<void> {
  const cache = await open();
  await cache?.delete(SESSION_KEY);
}

/** Whether the previous session ended without clearing its flag. */
export async function wasUnclean(): Promise<boolean> {
  const cache = await open();
  if (!cache) return false;
  return cache.has(SESSION_KEY);
}

/** Records that the project reached a file, so recovery can compare. */
export async function markSavedToFile(savedAt = Date.now()): Promise<void> {
  const cache = await open();
  await cache?.set(CLEAN_KEY, encoder.encode(String(savedAt)));
}

/** When the project was last written to a real file, or null. */
export async function lastCleanSave(): Promise<number | null> {
  const cache = await open();
  const bytes = await cache?.get(CLEAN_KEY);
  if (!bytes) return null;
  const value = Number(decoder.decode(bytes));
  return Number.isFinite(value) ? value : null;
}

export interface RecoveryOffer {
  /** The newest revision, if there is one worth offering. */
  revision: Revision;
  /** Every revision, for the "older version" list. */
  all: Revision[];
  /** Whether the previous session ended in a crash rather than cleanly. */
  afterCrash: boolean;
  /** Whether this is newer than the last explicit save to a file. */
  newerThanFile: boolean;
}

/**
 * What to offer at launch, or null for nothing.
 *
 * Deliberately quiet: an autosave older than the last real save has nothing to
 * add, and offering recovery every single launch trains people to dismiss the
 * dialog without reading it — which is precisely when it matters.
 */
export async function recoveryOffer(): Promise<RecoveryOffer | null> {
  const [revisions, crashed, cleanAt] = await Promise.all([
    listRevisions(),
    wasUnclean(),
    lastCleanSave(),
  ]);

  const newest = revisions[0];
  if (!newest) return null;

  const newerThanFile = cleanAt === null || newest.savedAt > cleanAt;
  if (!crashed && !newerThanFile) return null;

  return { revision: newest, all: revisions, afterCrash: crashed, newerThanFile };
}

/** Drops every revision. Used when the user declines recovery. */
export async function clearRevisions(): Promise<void> {
  const cache = await open();
  if (!cache) return;
  for (const key of await cache.keys()) {
    if (key.startsWith(REVISION_PREFIX)) await cache.delete(key);
  }
}

/**
 * Removes the document the old autosave left in localStorage.
 *
 * It is dead weight against a ~5 MB quota shared with the UI preferences that
 * still live there, and leaving it would eventually make *those* fail to save
 * for the same silent reason.
 */
export function dropLegacyLocalStorageDoc(): void {
  try {
    localStorage.removeItem("vide-os:project-doc");
  } catch {
    // Storage can be unavailable entirely; nothing here is worth failing over.
  }
}
