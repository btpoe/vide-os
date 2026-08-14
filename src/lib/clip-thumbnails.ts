/**
 * Filmstrip thumbnails for the timeline.
 *
 * What this replaces: one `<video>` element per media file, seeked to 0.5 s, one
 * 80×45 data URL. Phase 3 deleted `frame-source.ts` precisely to stop using
 * `<video>` for decode — the elements leak toward Chrome's decoder cap and
 * cannot seek accurately — and this path survived the cull only because nothing
 * pointed at it. It now decodes through Mediabunny's `CanvasSink`, the same
 * demuxer stack as the rest of the media engine, in one pass over sorted
 * timestamps.
 *
 * The result is a single-row sprite sheet plus the arithmetic to index it, so a
 * clip can show a strip that follows its own trim, slip and speed rather than
 * one frame stretched across it. One image per file means one decode, one cache
 * entry, and one GPU texture however many tiles a clip draws.
 */

import { CanvasSink } from "mediabunny";
import { createBlobSource } from "@/media/source";
import { openInput } from "@/media/probe";
import { platform } from "@/platform";
import type { Bytes, CacheStore } from "@/platform/types";

const CACHE_NAME = "filmstrips";
const FORMAT_VERSION = 1;
const MAGIC = 0x56465331; // "VFS1"

/** Tile height in pixels. Widths follow the source's aspect ratio. */
const TILE_HEIGHT = 45;
const MIN_TILE_WIDTH = 16;
const MAX_TILE_WIDTH = 160;

/** One tile per this many seconds, before the caps below apply. */
const SECONDS_PER_TILE = 2;
const MIN_TILES = 4;
const MAX_TILES = 120;

/**
 * Chrome refuses canvases wider than 16384 px, and a sheet that fails to
 * allocate is a decoration silently missing on exactly the longest files.
 */
const MAX_SHEET_WIDTH = 16000;

export interface Filmstrip {
  /** Object URL of the sprite sheet: `tiles` frames in a single row. */
  url: string;
  tiles: number;
  tileWidth: number;
  tileHeight: number;
  /** Source seconds each tile covers, so a tile index is a source time. */
  secondsPerTile: number;
  durationSec: number;
}

const strips = new Map<string, Filmstrip>();
const pending = new Map<string, Promise<Filmstrip | null>>();
/** Assets with no decodable video. Attempted once. */
const unavailable = new Set<string>();

export function getCachedFilmstrip(assetId: string): Filmstrip | null {
  return strips.get(assetId) ?? null;
}

/**
 * The sheet tile covering a source time.
 *
 * Clamped rather than wrapped: a clip trimmed past the end of its media should
 * hold the last frame, not restart.
 */
export function tileIndexAt(strip: Filmstrip, sourceSec: number): number {
  if (strip.secondsPerTile <= 0) return 0;
  const index = Math.floor(sourceSec / strip.secondsPerTile);
  return index < 0 ? 0 : index >= strip.tiles ? strip.tiles - 1 : index;
}

// ── Generation ────────────────────────────────────────────────────────

function tileCountFor(durationSec: number, tileWidth: number): number {
  const wanted = Math.ceil(durationSec / SECONDS_PER_TILE);
  const byWidth = Math.floor(MAX_SHEET_WIDTH / tileWidth);
  return Math.max(
    1,
    Math.min(wanted < MIN_TILES ? MIN_TILES : wanted, MAX_TILES, byWidth),
  );
}

async function encodeSheet(canvas: OffscreenCanvas): Promise<Blob | null> {
  // WebP is a third the size of JPEG at this quality and is what every browser
  // with WebCodecs also has; JPEG covers the rest.
  for (const type of ["image/webp", "image/jpeg"]) {
    try {
      const blob = await canvas.convertToBlob({ type, quality: 0.72 });
      if (blob.size > 0) return blob;
    } catch {
      // Try the next encoder.
    }
  }
  return null;
}

interface GeneratedStrip {
  image: Blob;
  tiles: number;
  tileWidth: number;
  tileHeight: number;
  secondsPerTile: number;
  durationSec: number;
}

async function generateVideoStrip(blob: Blob): Promise<GeneratedStrip | null> {
  const input = openInput(createBlobSource(blob));
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) return null;
    if (!(await track.canDecode().catch(() => false))) return null;

    const durationSec = await track.computeDuration().catch(() => 0);
    if (durationSec <= 0) return null;

    const aspect =
      track.displayHeight > 0 ? track.displayWidth / track.displayHeight : 16 / 9;
    const tileWidth = Math.min(
      MAX_TILE_WIDTH,
      Math.max(MIN_TILE_WIDTH, Math.round(TILE_HEIGHT * aspect)),
    );
    const tiles = tileCountFor(durationSec, tileWidth);
    const secondsPerTile = durationSec / tiles;

    const sheet = new OffscreenCanvas(tiles * tileWidth, TILE_HEIGHT);
    const ctx = sheet.getContext("2d");
    if (!ctx) return null;

    const sink = new CanvasSink(track, {
      width: tileWidth,
      height: TILE_HEIGHT,
      fit: "cover",
      poolSize: 2,
    });

    // Sorted timestamps, so the sink decodes each packet at most once instead of
    // seeking back and forth. Sampling the middle of each tile's span rather
    // than its edge keeps a cut from landing on the very first frame of a shot.
    const timestamps: number[] = [];
    for (let i = 0; i < tiles; i++) {
      timestamps.push(Math.min(durationSec - 1e-6, (i + 0.5) * secondsPerTile));
    }

    let index = 0;
    let drawn = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (wrapped) {
        ctx.drawImage(wrapped.canvas, index * tileWidth, 0, tileWidth, TILE_HEIGHT);
        drawn++;
      }
      index++;
    }
    if (drawn === 0) return null;

    const image = await encodeSheet(sheet);
    if (!image) return null;

    return {
      image,
      tiles,
      tileWidth,
      tileHeight: TILE_HEIGHT,
      secondsPerTile,
      durationSec,
    };
  } finally {
    input.dispose();
  }
}

/**
 * A still image is a one-tile strip.
 *
 * The old path handed a JPEG to a `<video>` element, which never fires
 * `loadeddata`, so an image clip waited five seconds for a timeout and got
 * nothing. Mediabunny does not demux stills either, so this is the one
 * decoration that does not go through the media engine.
 */
async function generateImageStrip(blob: Blob): Promise<GeneratedStrip | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const aspect = bitmap.height > 0 ? bitmap.width / bitmap.height : 16 / 9;
    const tileWidth = Math.min(
      MAX_TILE_WIDTH,
      Math.max(MIN_TILE_WIDTH, Math.round(TILE_HEIGHT * aspect)),
    );

    const sheet = new OffscreenCanvas(tileWidth, TILE_HEIGHT);
    const ctx = sheet.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, tileWidth, TILE_HEIGHT);

    const image = await encodeSheet(sheet);
    if (!image) return null;

    return {
      image,
      tiles: 1,
      tileWidth,
      tileHeight: TILE_HEIGHT,
      // A still shows the same frame at every point, so one tile covers it all.
      secondsPerTile: Number.MAX_SAFE_INTEGER,
      durationSec: 0,
    };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * One decoded frame, for the media pool's poster.
 *
 * Separate from the strip because import should not wait for a hundred and
 * twenty tiles, and because this is the call that let `generateVideoThumbnail`
 * — and with it the last `<video>` element used for decoding — be deleted.
 */
export async function posterFrame(blob: Blob, height = 90): Promise<string | null> {
  const input = openInput(createBlobSource(blob));
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) return null;
    if (!(await track.canDecode().catch(() => false))) return null;

    const durationSec = await track.computeDuration().catch(() => 0);
    const aspect =
      track.displayHeight > 0 ? track.displayWidth / track.displayHeight : 16 / 9;
    const width = Math.max(2, Math.round(height * aspect));
    const sink = new CanvasSink(track, { width, height, fit: "cover", poolSize: 1 });

    // A tenth in, capped at a second: frame zero is often black or a slate.
    const wrapped = await sink.getCanvas(Math.min(1, durationSec * 0.1));
    if (!wrapped) return null;

    // Copied into a canvas of our own: the sink yields an `HTMLCanvasElement`
    // in a DOM context and an `OffscreenCanvas` elsewhere, and only one of the
    // two can encode itself.
    const target = new OffscreenCanvas(width, height);
    const ctx = target.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(wrapped.canvas, 0, 0, width, height);

    const encoded = await encodeSheet(target);
    return encoded ? URL.createObjectURL(encoded) : null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

// ── Cache ─────────────────────────────────────────────────────────────

let store: Promise<CacheStore> | null = null;
function filmstripStore(): Promise<CacheStore> {
  store ??= platform.cache.open(CACHE_NAME);
  return store;
}

interface StripHeader {
  tiles: number;
  tileWidth: number;
  tileHeight: number;
  secondsPerTile: number;
  durationSec: number;
  mime: string;
}

/**
 * Header and image in one entry.
 *
 * Two keys would make a torn write possible — a sheet whose tile count is a
 * previous file's — and there is nothing to reconcile them with, since both are
 * derived.
 */
function pack(strip: GeneratedStrip, image: Bytes): Bytes {
  const header: StripHeader = {
    tiles: strip.tiles,
    tileWidth: strip.tileWidth,
    tileHeight: strip.tileHeight,
    secondsPerTile: strip.secondsPerTile,
    durationSec: strip.durationSec,
    mime: strip.image.type || "image/webp",
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));

  const out = new Uint8Array(new ArrayBuffer(12 + headerBytes.length + image.length));
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC);
  view.setUint32(4, FORMAT_VERSION);
  view.setUint32(8, headerBytes.length);
  out.set(headerBytes, 12);
  out.set(image, 12 + headerBytes.length);
  return out;
}

function unpack(bytes: Uint8Array): Filmstrip | null {
  try {
    if (bytes.length < 12) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0) !== MAGIC) return null;
    if (view.getUint32(4) !== FORMAT_VERSION) return null;

    const headerLength = view.getUint32(8);
    if (12 + headerLength > bytes.length) return null;

    const header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)),
    ) as StripHeader;
    const image = bytes.subarray(12 + headerLength);
    if (image.length === 0) return null;

    const url = URL.createObjectURL(
      new Blob([image.slice()], { type: header.mime || "image/webp" }),
    );
    return {
      url,
      tiles: header.tiles,
      tileWidth: header.tileWidth,
      tileHeight: header.tileHeight,
      secondsPerTile: header.secondsPerTile,
      durationSec: header.durationSec,
    };
  } catch {
    return null;
  }
}

async function fromDisk(assetId: string): Promise<Filmstrip | null> {
  try {
    const bytes = await (await filmstripStore()).get(assetId);
    return bytes ? unpack(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * The filmstrip for an asset, generating it if neither tier has it.
 *
 * `kind` decides which generator runs. Probing for it would cost a demux of
 * every still in the pool to learn what the media pool already knows.
 */
export function getFilmstrip(
  assetId: string,
  blob: Blob,
  kind: "video" | "image",
): Promise<Filmstrip | null> {
  const cached = strips.get(assetId);
  if (cached) return Promise.resolve(cached);
  if (unavailable.has(assetId)) return Promise.resolve(null);

  const existing = pending.get(assetId);
  if (existing) return existing;

  const work = (async () => {
    const onDisk = await fromDisk(assetId);
    if (onDisk) return onDisk;

    const generated =
      kind === "image"
        ? await generateImageStrip(blob)
        : await generateVideoStrip(blob);
    if (!generated) return null;

    const image = new Uint8Array(await generated.image.arrayBuffer());
    // Awaited, not fired off: this is already a background job, and a caller
    // that returns before the write lands cannot be told the sheet is cached.
    try {
      await (await filmstripStore()).set(assetId, pack(generated, image));
    } catch {
      // A full cache costs a regenerate next launch, nothing more.
    }

    return {
      url: URL.createObjectURL(generated.image),
      tiles: generated.tiles,
      tileWidth: generated.tileWidth,
      tileHeight: generated.tileHeight,
      secondsPerTile: generated.secondsPerTile,
      durationSec: generated.durationSec,
    };
  })()
    .then((strip) => {
      if (strip) strips.set(assetId, strip);
      else unavailable.add(assetId);
      return strip;
    })
    .catch(() => {
      unavailable.add(assetId);
      return null;
    })
    .finally(() => pending.delete(assetId));

  pending.set(assetId, work);
  return work;
}

export function clearFilmstrip(assetId: string): void {
  const strip = strips.get(assetId);
  if (strip) URL.revokeObjectURL(strip.url);
  strips.delete(assetId);
  unavailable.delete(assetId);
}

export function clearAllFilmstrips(): void {
  for (const strip of strips.values()) URL.revokeObjectURL(strip.url);
  strips.clear();
  unavailable.clear();
}

/** Drops the persisted sheets too. Only for an explicit "clear cache" action. */
export async function purgeFilmstripCache(): Promise<void> {
  clearAllFilmstrips();
  await (await filmstripStore()).clear().catch(() => undefined);
}
