import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import TrackLane from "@/panels/timeline/TrackLane";
import { loadDocument, applyEdit, doc } from "@/stores/project-store";
import {
  setViewportWidth,
  setScrollLeft,
  zoomToFrameRange,
} from "@/stores/timeline-view-store";
import { addMediaEntry, clearMedia } from "@/stores/media-store";
import { resetPreviewRequests } from "@/lib/media-previews";
import { clearAllWaveforms } from "@/lib/waveform-cache";
import { clearAllFilmstrips } from "@/lib/clip-thumbnails";
import { fileRefFromFile } from "@/platform/web/fs";
import { createEmptyDoc, type Track } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { makeTestVideo } from "../fixtures/make-media";

/**
 * The join between the timeline and the decoration generators.
 *
 * The generators are covered by `decorations.test.ts`, which calls them
 * directly. That is not the same thing, and this project has already been bitten
 * once by the difference: every renderer test warmed the frame cache itself, so
 * the preview could be black on every launch with the whole suite green. A test
 * whose setup performs a step the application must also perform is not testing
 * the application.
 *
 * So nothing here asks for a decoration. It puts a clip on a real lane and waits
 * for a picture to turn up, which is exactly what a person does.
 */

const ASSET_ID = "decoration-join-fixture";
const FPS = 30;
const FRAMES = 60;

let host: HTMLDivElement | null = null;
let dispose: (() => void) | null = null;
let fixture: File;

function mountLane(track: Track): HTMLElement {
  host = document.createElement("div");
  host.setAttribute("data-timeline-strip", "");
  host.style.cssText = "position:fixed;left:0;top:0;width:900px;height:120px";
  document.body.append(host);

  dispose = render(
    () => <TrackLane track={track} heightPx={60} isDropTarget={false} />,
    host,
  );
  return host;
}

beforeAll(async () => {
  const blob = await makeTestVideo({
    width: 128,
    height: 72,
    fps: FPS,
    frames: FRAMES,
    withAudio: true,
    toneGain: (seconds) => (seconds < 1 ? 0.05 : 0.9),
  });

  fixture = new File([blob], "join-fixture.mp4", { type: "video/mp4" });
}, 120_000);

beforeEach(() => {
  setViewportWidth(900);
  setScrollLeft(0);
  zoomToFrameRange(0, 120);

  // A media-pool entry the way an import makes one: bytes reachable through a
  // platform ref, which is the only thing `entryFile` will accept. Rebuilt per
  // test because the teardown clears the pool, and a decoration request for a
  // media id the pool has never heard of returns without doing anything — which
  // is how the second of these tests first "passed" by never running.
  addMediaEntry({
    id: ASSET_ID,
    name: fixture.name,
    type: "video",
    size: fixture.size,
    ref: fileRefFromFile(fixture),
  });

  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  loadDocument(base);

  applyEdit("setup", (d) => {
    edits.upsertAsset(d, {
      id: ASSET_ID,
      name: fixture.name,
      kind: "video",
      size: fixture.size,
      durationSec: FRAMES / FPS,
      hasAudio: true,
      width: 128,
      height: 72,
    });
  });
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  // The queue attempts each decoration once per media, so a second test would
  // otherwise be served by the first test's result and prove nothing.
  resetPreviewRequests();
  clearAllWaveforms();
  clearAllFilmstrips();
  loadDocument(createEmptyDoc());
  clearMedia();
});

/** Adds a clip to the first empty track of a kind and returns that track. */
function clipOn(kind: "video" | "audio"): Track {
  applyEdit("place", (d) => {
    const track = d.tracks.find((t) => t.kind === kind && t.clips.length === 0);
    if (!track) return;
    edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
      startFrame: 0,
    });
  });
  return doc().tracks.find((t) => t.kind === kind && t.clips.length > 0)!;
}

describe("a clip on a lane grows its own decorations", () => {
  it("draws a filmstrip on a video clip without being asked", async () => {
    const lane = mountLane(clipOn("video"));

    await vi.waitFor(
      () => {
        expect(lane.querySelector("[data-filmstrip]")).not.toBeNull();
      },
      { timeout: 30_000, interval: 100 },
    );

    // More than one tile: a single frame stretched across the clip is what the
    // old generator produced, and it would satisfy a presence-only assertion.
    const tiles = lane.querySelectorAll("[data-filmstrip] > div");
    expect(tiles.length).toBeGreaterThan(1);

    const first = tiles[0] as HTMLElement;
    const second = tiles[1] as HTMLElement;
    expect(first.style.backgroundImage).toContain("blob:");
    // Consecutive tiles index different parts of the sheet, so the strip moves.
    expect(first.style.backgroundPosition).not.toBe(second.style.backgroundPosition);
  }, 60_000);

  it("draws a waveform on an audio clip without being asked", async () => {
    const lane = mountLane(clipOn("audio"));

    await vi.waitFor(
      () => {
        expect(lane.querySelector("[data-waveform]")).not.toBeNull();
      },
      { timeout: 30_000, interval: 100 },
    );

    const svg = lane.querySelector("[data-waveform]")!;
    const path = svg.querySelector("path")!.getAttribute("d") ?? "";
    const points = path.split("L").length - 1;

    // One column per pixel of clip width, not a fixed 200 peaks stretched to
    // fit. The clip is a few hundred pixels wide here, and the path walks the
    // tops and then the bottoms, so the point count is twice the column count.
    expect(points).toBeGreaterThan(400);

    // The viewBox width is the column count, which is what makes the path
    // resolution-independent when the lane is resized.
    const viewBox = svg.getAttribute("viewBox") ?? "";
    expect(Number(viewBox.split(" ")[2])).toBeGreaterThan(200);
  }, 60_000);
});
