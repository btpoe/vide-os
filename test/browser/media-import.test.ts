import { describe, it, expect, afterEach } from "vitest";
import { importFileHandle, clearMedia } from "@/stores/media-store";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { loadDocument, doc, applyEdit } from "@/stores/project-store";
import { createEmptyDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { makeTestVideo } from "../fixtures/make-media";

/**
 * Importing a file, through the door the application actually uses.
 *
 * Every other media test hands the engine a blob itself — `openBlob(id, blob)`
 * — and then asserts that decoding works. That is a test of the engine, not of
 * the app: nothing in the product called `openBlob`, so an imported file was
 * never registered and every clip decoded to nothing. The preview tests missed
 * it for the same reason, because their setup performed the registration the
 * app omitted.
 *
 * So this file imports through `importFileHandle` and asserts on the engine and
 * the document afterwards, priming nothing.
 */

const SIZE = 64;
const FRAMES = 30;

let silent: Blob | null = null;
let audible: Blob | null = null;

async function silentVideo(): Promise<Blob> {
  silent ??= await makeTestVideo({
    fps: 30,
    frames: FRAMES,
    width: SIZE,
    height: SIZE,
  });
  return silent;
}

async function audibleVideo(): Promise<Blob> {
  audible ??= await makeTestVideo({
    fps: 30,
    frames: FRAMES,
    width: SIZE,
    height: SIZE,
    withAudio: true,
  });
  return audible;
}

/**
 * The half of `FileSystemFileHandle` the import path uses.
 *
 * Browser mode cannot produce a real one — that needs the OS picker, which is
 * the single flow no automated tier can reach.
 */
function fakeHandle(name: string, blob: Blob): FileSystemFileHandle {
  const file = new File([blob], name, { type: blob.type });
  return {
    kind: "file",
    name,
    getFile: () => Promise.resolve(file),
    queryPermission: () => Promise.resolve("granted"),
    requestPermission: () => Promise.resolve("granted"),
    isSameEntry: () => Promise.resolve(false),
  } as unknown as FileSystemFileHandle;
}

function freshDoc(): void {
  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  base.sequence.width = SIZE;
  base.sequence.height = SIZE;
  loadDocument(base);
}

afterEach(() => {
  clearMedia();
  forgetAllAssets();
  loadDocument(createEmptyDoc());
});

describe("importing a file the way the app does", () => {
  it("registers it with the media engine", async () => {
    freshDoc();
    const entry = await importFileHandle(fakeHandle("clip.mp4", await silentVideo()));
    expect(entry).toBeTruthy();

    // Without this the decoder pool cannot build a decoder, and the clip is
    // black no matter what the rest of the pipeline does.
    const asset = mediaEngine.asset(entry!.id);
    expect(asset, "the imported file should be open in the engine").toBeTruthy();
    expect(asset!.videoTrack, "its video track should be reachable").toBeTruthy();
  });

  it("decodes a frame of the clip it imported, with nothing primed", async () => {
    freshDoc();
    const entry = await importFileHandle(fakeHandle("clip.mp4", await silentVideo()));

    applyEdit("place", (d) => {
      const track = d.tracks.find((t) => t.kind === "video")!;
      edits.insertClip(d, track.id, { type: "asset", assetId: entry!.id }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
      });
    });

    const clip = doc().tracks.flatMap((t) => t.clips)[0];
    const borrowed = await mediaEngine.getExact(doc(), clip, 5);
    expect(borrowed, "an imported clip should decode").toBeTruthy();
    borrowed?.release();
  });

  it("takes duration and size from the probe, not from a <video> element", async () => {
    freshDoc();
    const entry = await importFileHandle(fakeHandle("clip.mp4", await silentVideo()));

    const asset = doc().assets.find((a) => a.id === entry!.id);
    expect(asset).toBeTruthy();
    expect(asset!.width).toBe(SIZE);
    expect(asset!.height).toBe(SIZE);
    expect(asset!.durationSec).toBeGreaterThan(0.9);
    expect(asset!.durationSec).toBeLessThan(1.2);
  });

  it("knows whether there is really an audio track", async () => {
    // `hasAudio` was guessed from `mozHasAudio` and `webkitAudioDecodedByteCount`
    // — neither of which Chromium sets before playback — and fell back to
    // "assume yes". The demuxer just knows.
    freshDoc();
    const quiet = await importFileHandle(fakeHandle("quiet.mp4", await silentVideo()));
    expect(doc().assets.find((a) => a.id === quiet!.id)!.hasAudio).toBe(false);

    freshDoc();
    clearMedia();
    forgetAllAssets();
    const loud = await importFileHandle(fakeHandle("loud.mp4", await audibleVideo()));
    expect(doc().assets.find((a) => a.id === loud!.id)!.hasAudio).toBe(true);
  });
});
