/**
 * Reading and writing project files.
 *
 * A `.videos` file is a zip bundle:
 *
 * ```
 * project.json          the document
 * media.json            asset table with relink hints
 * thumbnails/<key>.jpg  optional, regenerable
 * waveforms/<key>.bin   optional, regenerable
 * ```
 *
 * A bare `project.json` is also valid input, so the bundle is a strict superset
 * and a project stays diffable and hand-editable.
 *
 * The old format saved only `tracks`, `duration`, `fps`, `width` and `height` —
 * no media list at all — while clips referenced `Date.now()` ids. Such a file
 * could not be reopened anywhere, including on the machine that wrote it.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { type ProjectDoc, DOC_FORMAT_VERSION } from "./doc";
import { validateDoc } from "./invariants";
import { migrate, type MigrationResult } from "./migrate";
import type { Bytes } from "@/platform";

const PROJECT_ENTRY = "project.json";
const MEDIA_ENTRY = "media.json";

/** Per-asset information needed to find the file again on another machine. */
export interface AssetLocation {
  /** Content key — the asset's id. */
  id: string;
  name: string;
  size: number;
  mtime?: number;
  /** Path relative to the project file, when known. */
  relPath?: string;
  /** Platform token from `persistRef`, valid only on the machine that saved. */
  handleToken?: string;
}

export interface MediaTable {
  formatVersion: number;
  assets: AssetLocation[];
}

export interface ProjectBundle {
  doc: ProjectDoc;
  media: MediaTable;
  /** Derived caches, keyed by their path inside the bundle. */
  extras?: Record<string, Bytes>;
}

export interface LoadResult extends MigrationResult {
  media: MediaTable;
}

// ── Serialisation ─────────────────────────────────────────────────────

export function serializeDoc(doc: ProjectDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parses and migrates a project.
 *
 * Validation happens here rather than at every read site: the previous open
 * path assigned `data.tracks` straight into the store with no checking at all,
 * so a malformed or hand-edited file produced a broken editor rather than an
 * error message.
 */
export function parseDoc(text: string): MigrationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Not a valid project file: ${error instanceof Error ? error.message : "unparseable JSON"}`,
      { cause: error },
    );
  }

  const result = migrate(raw);
  const violations = validateDoc(result.doc);
  if (violations.length > 0) {
    throw new Error(
      `Project file is not valid:\n${violations
        .slice(0, 5)
        .map((v) => `  ${v.path}: ${v.message}`)
        .join("\n")}`,
    );
  }
  return result;
}

export function mediaTableFromDoc(
  doc: ProjectDoc,
  locations: Map<string, Omit<AssetLocation, "id" | "name" | "size">> = new Map(),
): MediaTable {
  return {
    formatVersion: DOC_FORMAT_VERSION,
    assets: doc.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      mtime: asset.mtime,
      relPath: asset.relPath,
      ...locations.get(asset.id),
    })),
  };
}

// ── Bundle ────────────────────────────────────────────────────────────

/** Packs a project into a `.videos` zip. */
export function packBundle(bundle: ProjectBundle): Bytes {
  const entries: Record<string, Uint8Array> = {
    [PROJECT_ENTRY]: strToU8(serializeDoc(bundle.doc)),
    [MEDIA_ENTRY]: strToU8(JSON.stringify(bundle.media, null, 2)),
  };
  for (const [path, data] of Object.entries(bundle.extras ?? {})) {
    entries[path] = data;
  }
  // Thumbnails and waveforms are already compressed; level 6 on the JSON is
  // where the win is, and deflating JPEGs again just costs time.
  return zipSync(entries, { level: 6 });
}

/**
 * Reads a `.videos` bundle or a bare `project.json`.
 *
 * Sniffing the zip magic rather than trusting the extension means a project
 * renamed by a user still opens.
 */
export function readProjectFile(data: Bytes): LoadResult {
  if (looksLikeZip(data)) return readBundle(data);

  const result = parseDoc(strFromU8(data));
  return { ...result, media: mediaTableFromDoc(result.doc) };
}

function looksLikeZip(data: Bytes): boolean {
  // "PK\x03\x04"
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  );
}

function readBundle(data: Bytes): LoadResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (error) {
    throw new Error(
      `Could not read the project bundle: ${error instanceof Error ? error.message : "corrupt zip"}`,
      { cause: error },
    );
  }

  const projectEntry = files[PROJECT_ENTRY];
  if (!projectEntry) {
    throw new Error(`Project bundle is missing ${PROJECT_ENTRY}.`);
  }

  const result = parseDoc(strFromU8(projectEntry));

  let media: MediaTable;
  const mediaEntry = files[MEDIA_ENTRY];
  if (mediaEntry) {
    try {
      media = JSON.parse(strFromU8(mediaEntry)) as MediaTable;
    } catch {
      // A damaged media table costs relink hints, not the project.
      media = mediaTableFromDoc(result.doc);
      result.warnings.push(
        "The media table could not be read; media may need relinking.",
      );
    }
  } else {
    media = mediaTableFromDoc(result.doc);
  }

  return { ...result, media };
}

/** Extracts a derived-cache entry from a bundle, if present. */
export function readBundleExtra(data: Bytes, path: string): Bytes | null {
  if (!looksLikeZip(data)) return null;
  try {
    const entry = unzipSync(data, { filter: (f) => f.name === path })[path];
    return entry ?? null;
  } catch {
    return null;
  }
}

/** Filename for a project, safe across filesystems. */
export function projectFileName(name: string): string {
  const safe = name
    .replace(/[^\w\-. ]+/g, "_")
    // Trim the padding too: a name of only separators sanitises to "_", which
    // is truthy and would otherwise produce a file called "_.videos".
    .replace(/^[_\s.]+|[_\s.]+$/g, "");
  return `${safe || "Untitled Project"}.videos`;
}
