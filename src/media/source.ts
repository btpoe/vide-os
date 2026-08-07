/**
 * Byte access for the demuxer.
 *
 * The whole platform seam reduces to this: a demuxer needs to read arbitrary
 * byte ranges of a file, and `platform.fs.read(ref, range)` provides exactly
 * that. Wrapping it once here means the media engine behaves identically on
 * web and on a desktop shell, with no other code needing to know which it is.
 *
 * Reads are ranged, never whole-file: a 40 GB camera card must be demuxable
 * without loading it into memory.
 */

import { CustomSource } from "mediabunny";
import { platform, type FileRef } from "@/platform";

/**
 * A source backed by a platform file reference.
 *
 * `fileSystem` prefetching tells Mediabunny to read a little either side of
 * each request on page boundaries, which suits a local file: latency is low
 * but per-call overhead is not free.
 */
export function createPlatformSource(ref: FileRef): CustomSource {
  return new CustomSource({
    getSize: () => platform.fs.stat(ref).then((s) => s.size),
    read: (start, end) => platform.fs.read(ref, { offset: start, length: end - start }),
    prefetchProfile: "fileSystem",
  });
}

/**
 * A source over an in-memory blob, for media that never had a file reference —
 * a drag-and-drop `File`, or a generated test fixture.
 */
export function createBlobSource(blob: Blob): CustomSource {
  return new CustomSource({
    getSize: () => blob.size,
    read: async (start, end) =>
      new Uint8Array(await blob.slice(start, end).arrayBuffer()),
    prefetchProfile: "fileSystem",
  });
}
