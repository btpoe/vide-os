/**
 * The active platform.
 *
 * Today this always resolves to the web implementation. When the desktop shell
 * lands, this module is where the build swaps in the Tauri one — every other
 * file imports `platform` from here and needs no change.
 */

import type { Platform } from "./types";
import { webPlatform } from "./web";

export const platform: Platform = webPlatform;

export type {
  Bytes,
  Platform,
  PlatformFs,
  PlatformCache,
  PlatformTranscode,
  CacheStore,
  FileRef,
  DirRef,
  DirEntry,
  ByteRange,
  PermissionState,
  PickFilesOptions,
  PickSaveOptions,
  MediaProbeResult,
} from "./types";

export { fileRefFromFile } from "./web";
