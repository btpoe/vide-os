/**
 * Identity for documents and media.
 *
 * Two different kinds of id:
 *
 * - Document ids (clips, tracks, keyframes) are random UUIDs. They only need to
 *   be unique within one project and stable across saves.
 * - Asset ids are *content* keys derived from the bytes of the file. That makes
 *   a project file portable: reopening it on another machine can match media by
 *   what it is rather than by where it was, and re-importing the same file
 *   twice resolves to one asset instead of two.
 *
 * The previous scheme minted both from `Date.now()`, which is why saved
 * projects referenced media ids that could never be resolved again.
 */

/** Random id for in-document objects. */
export function newId(prefix = ""): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : fallbackUuid();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

function fallbackUuid(): string {
  // Non-secure contexts (and some older embedded webviews) lack randomUUID.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── Content keys ──────────────────────────────────────────────────────

/** Bytes sampled from each end of the file when hashing. */
const SAMPLE_BYTES = 1024 * 1024;
/** Hex characters kept from the digest. 32 chars = 128 bits. */
const KEY_LENGTH = 32;

export type ContentKey = string;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Content key for a blob: SHA-256 over the first and last megabyte plus the
 * byte length, truncated to 128 bits.
 *
 * Sampling rather than hashing the whole file keeps import fast — a 40 GB
 * camera card would otherwise be read end to end just to name it. Including the
 * length means two files that share a header and a footer but differ in the
 * middle still get different keys unless they are also the same size, which is
 * a collision risk far below the level that matters for matching media.
 */
export async function computeContentKey(blob: Blob): Promise<ContentKey> {
  const size = blob.size;

  let sampled: Blob;
  if (size <= SAMPLE_BYTES * 2) {
    sampled = blob;
  } else {
    sampled = new Blob([blob.slice(0, SAMPLE_BYTES), blob.slice(size - SAMPLE_BYTES)]);
  }

  const sampleBuffer = await sampled.arrayBuffer();

  // Length is mixed in as 8 explicit bytes so it can't be confused with file
  // content, and so it is included even when the file is small enough to hash
  // whole.
  const lengthBytes = new Uint8Array(8);
  new DataView(lengthBytes.buffer).setBigUint64(0, BigInt(size));

  const payload = new Uint8Array(sampleBuffer.byteLength + 8);
  payload.set(new Uint8Array(sampleBuffer), 0);
  payload.set(lengthBytes, sampleBuffer.byteLength);

  const digest = await crypto.subtle.digest("SHA-256", payload);
  return toHex(digest).slice(0, KEY_LENGTH);
}

/** Whether a string looks like a content key rather than a legacy media id. */
export function isContentKey(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${KEY_LENGTH}}$`).test(value);
}
