import type { Platform } from "../types";
import { webFs } from "./fs";
import { webCache } from "./cache";

export const webPlatform: Platform = {
  name: "web",
  fs: webFs,
  cache: webCache,
  // `transcode` is deliberately absent: ffmpeg.wasm is a multi-megabyte
  // download, so it is opted into later rather than bundled.
  canPersistRefs: true,
};

export { fileRefFromFile, resetWebFs } from "./fs";
export { opfsAvailable } from "./cache";
