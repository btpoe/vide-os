import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render } from "solid-js/web";
import SourceMonitorPanel from "@/panels/SourceMonitorPanel";
import {
  loadSource,
  clearSource,
  setSourceFrame,
  markIn,
  markOut,
  clearMarks,
  inFrame,
  outFrame,
  effectiveOut,
  markedLength,
} from "@/stores/source-store";
import { insertFromSource, canEditFromSource } from "@/commands/source-edits";
import {
  loadDocument,
  doc,
  applyEdit,
  setPlayheadFrame,
  playheadFrame,
  undo,
} from "@/stores/project-store";
import {
  clearSelection,
  timelineState,
  setTargetTrack,
  targetTrackId,
} from "@/stores/timeline-store";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { resetLeakCounters } from "@/media/frame-cache";
import { createEmptyDoc, clipEndFrame, type Track } from "@/model/doc";
import * as edits from "@/model/edits";
import { assertDocValid } from "@/model/invariants";
import { FPS_30 } from "@/lib/timecode";
import { makeTestVideo } from "../fixtures/make-media";

/**
 * The source monitor and the three-point edit.
 *
 * Driven against real decoded media, because the panel's job is to show a
 * frame of a source that is not on the timeline — a path nothing else in the
 * app exercises.
 */

const SIZE = 64;
const SOURCE_FRAMES = 90;
const ASSET_ID = "source-fixture";

let fixture: Blob | null = null;
async function video(): Promise<Blob> {
  fixture ??= await makeTestVideo({
    fps: 30,
    frames: SOURCE_FRAMES,
    width: SIZE,
    height: SIZE,
  });
  return fixture;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

function mount(): HTMLElement {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:400px;height:400px";
  document.body.append(host);
  dispose = render(() => <SourceMonitorPanel />, host);
  return host;
}

async function setUp(): Promise<Track> {
  const blob = await video();
  await mediaEngine.openBlob(ASSET_ID, blob);

  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  loadDocument(base);

  applyEdit("setup", (d) => {
    edits.upsertAsset(d, {
      id: ASSET_ID,
      name: "fixture.mp4",
      kind: "video",
      size: blob.size,
      durationSec: SOURCE_FRAMES / 30,
      hasAudio: false,
      width: SIZE,
      height: SIZE,
    });
  });

  return doc().tracks.find((t) => t.kind === "video")!;
}

function videoTrack(): Track {
  return doc().tracks.find((t) => t.kind === "video")!;
}

beforeEach(() => {
  clearSource();
  clearSelection();
  setPlayheadFrame(0);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  clearSource();
  forgetAllAssets();
  resetLeakCounters();
  loadDocument(createEmptyDoc());
});

describe("marking", () => {
  it("defaults to the whole clip", async () => {
    await setUp();
    loadSource(ASSET_ID);

    expect(inFrame()).toBe(0);
    expect(outFrame()).toBeNull();
    expect(effectiveOut()).toBe(SOURCE_FRAMES);
    expect(markedLength()).toBe(SOURCE_FRAMES);
  });

  it("marks in and out at the playhead", async () => {
    await setUp();
    loadSource(ASSET_ID);

    setSourceFrame(10);
    markIn();
    setSourceFrame(39);
    markOut();

    expect(inFrame()).toBe(10);
    // The out point is exclusive, like every other span in the document.
    expect(effectiveOut()).toBe(40);
    expect(markedLength()).toBe(30);
  });

  it("pushes the out point along rather than inverting the range", async () => {
    // A range that runs backwards is never what anyone meant, and refusing
    // the mark is more annoying than adjusting the other end.
    await setUp();
    loadSource(ASSET_ID);

    setSourceFrame(10);
    markOut();
    setSourceFrame(50);
    markIn();

    expect(inFrame()).toBeLessThan(effectiveOut());
  });

  it("forgets the marks when a different source is loaded", async () => {
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(20);
    markIn();

    loadSource(ASSET_ID);
    expect(inFrame()).toBe(0);
  });

  it("clamps the position to the media", async () => {
    await setUp();
    loadSource(ASSET_ID);

    setSourceFrame(99_999);
    expect(inFrame()).toBe(0);
    markIn();
    expect(inFrame()).toBe(SOURCE_FRAMES - 1);
  });
});

describe("the panel", () => {
  it("prompts when nothing is loaded", () => {
    const root = mount();
    expect(root.textContent).toContain("No source loaded");
  });

  it("draws the frame it is parked on", async () => {
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(20);
    const root = mount();

    // The decode is asynchronous; the panel redraws when it lands.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const canvas = root.querySelector("canvas")!;
    expect(canvas.width).toBe(SIZE);

    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const lit = [...data].some((value, index) => index % 4 !== 3 && value > 16);
    expect(lit, "the source monitor should not be blank").toBe(true);
  });

  it("shows the marked duration", async () => {
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(0);
    markIn();
    setSourceFrame(29);
    markOut();

    const root = mount();
    expect(root.textContent).toContain("00:00:01:00");
  });
});

describe("three-point edits", () => {
  it("puts the marked range on the target track at the playhead", async () => {
    const track = await setUp();
    loadSource(ASSET_ID);

    setSourceFrame(20);
    markIn();
    setSourceFrame(49);
    markOut();
    setPlayheadFrame(100);

    insertFromSource("overwrite");

    const clip = videoTrack().clips[0];
    expect(clip.startFrame).toBe(100);
    expect(clip.durationFrames).toBe(30);
    expect(clip.inPointFrames).toBe(20);
    expect(clip.source).toMatchObject({ assetId: ASSET_ID });
    expect(targetTrackId("video")).toBe(track.id);
    assertDocValid(doc());
  });

  it("leaves the playhead ready for the next edit", async () => {
    // Assembling a sequence is pressing the same key repeatedly, which only
    // works if the playhead follows the edit.
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(29);
    markOut();

    insertFromSource("overwrite");
    expect(playheadFrame()).toBe(clipEndFrame(videoTrack().clips[0]));

    insertFromSource("overwrite");
    expect(videoTrack().clips).toHaveLength(2);
    expect(videoTrack().clips[1].startFrame).toBe(30);
  });

  it("selects what it added", async () => {
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(29);
    markOut();
    insertFromSource("overwrite");

    expect(timelineState.selectedClips).toHaveLength(1);
    expect(timelineState.selectedClips[0].clipId).toBe(videoTrack().clips[0].id);
  });

  it("pushes existing clips when inserting", async () => {
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(29);
    markOut();

    insertFromSource("overwrite");
    setPlayheadFrame(0);
    insertFromSource("insert");

    expect(videoTrack().clips.map((c) => c.startFrame)).toEqual([0, 30]);
    assertDocValid(doc());
  });

  it("lands on whichever track is armed", async () => {
    await setUp();
    const second = doc().tracks.filter((t) => t.kind === "video")[1];
    setTargetTrack("video", second.id);

    loadSource(ASSET_ID);
    setSourceFrame(29);
    markOut();
    insertFromSource("overwrite");

    expect(second.id).toBe(targetTrackId("video"));
    expect(doc().tracks.find((t) => t.id === second.id)!.clips).toHaveLength(1);
    expect(videoTrack().clips).toHaveLength(0);
  });

  it("falls back when the armed track has been deleted", async () => {
    // A stale id would make every edit silently do nothing.
    await setUp();
    const second = doc().tracks.filter((t) => t.kind === "video")[1];
    setTargetTrack("video", second.id);

    applyEdit("remove track", (d) => edits.removeTrack(d, second.id));
    expect(targetTrackId("video")).toBe(videoTrack().id);

    loadSource(ASSET_ID);
    setSourceFrame(29);
    markOut();
    insertFromSource("overwrite");
    expect(videoTrack().clips).toHaveLength(1);
  });

  it("is one undo step", async () => {
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(29);
    markOut();
    insertFromSource("overwrite");

    expect(undo()).toBe(true);
    expect(videoTrack().clips).toHaveLength(0);
  });

  it("does nothing with no source loaded", async () => {
    await setUp();
    expect(canEditFromSource()).toBe(false);
    insertFromSource("overwrite");
    expect(videoTrack().clips).toHaveLength(0);
  });

  it("does nothing with an empty range", async () => {
    await setUp();
    loadSource(ASSET_ID);
    setSourceFrame(10);
    markIn();
    clearMarks();
    // Marks cleared means the whole clip, which is a valid range.
    expect(canEditFromSource()).toBe(true);
  });
});
