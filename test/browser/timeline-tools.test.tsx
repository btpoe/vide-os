import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render } from "solid-js/web";
import TrackLane from "@/panels/timeline/TrackLane";
import {
  loadDocument,
  doc,
  applyEdit,
  undo,
  historyEntries,
} from "@/stores/project-store";
import { clearSelection, selectClip, timelineState } from "@/stores/timeline-store";
import { setSelectedTool } from "@/stores/ui-store";
import {
  setViewportWidth,
  setScrollLeft,
  zoomToFrameRange,
  timelineView,
} from "@/stores/timeline-view-store";
import { createEmptyDoc, clipEndFrame, type Track } from "@/model/doc";
import * as edits from "@/model/edits";
import { assertDocValid } from "@/model/invariants";
import { FPS_30 } from "@/lib/timecode";

/**
 * The trim tools, driven through the actual DOM.
 *
 * These four were in the toolbar from the start, setting a state variable that
 * nothing read. The model operations behind them are unit-tested; what these
 * tests cover is the part that was missing — that pressing the tool and
 * dragging the clip reaches the operation at all, with the right arguments and
 * the right sign.
 */

const FPS = 30;
const SOURCE_FRAMES = 300;

/** Pixels for a number of frames, at whatever zoom the view settled on. */
function px(frames: number): number {
  return frames * timelineView().pxPerFrame;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

/**
 * A lane inside a strip, laid out at a known scale.
 *
 * The strip ancestor matters: interactions measure the pointer against
 * `[data-timeline-strip]`, and without one they return without doing anything.
 */
function mountLane(track: Track): HTMLElement {
  host = document.createElement("div");
  host.setAttribute("data-timeline-strip", "");
  // Positioned at a known origin so client coordinates map to frames simply.
  host.style.cssText = "position:fixed;left:0;top:0;width:900px;height:120px";
  document.body.append(host);

  dispose = render(
    () => <TrackLane track={track} heightPx={60} isDropTarget={false} />,
    host,
  );
  return host;
}

beforeEach(() => {
  setViewportWidth(900);
  setScrollLeft(0);
  // Wide enough that a ten-frame drag is unambiguous, and read back from the
  // view rather than assumed, since zooming to a range adds its own margin.
  zoomToFrameRange(0, 120);
  setSelectedTool("select");
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  clearSelection();
  setSelectedTool("select");
  loadDocument(createEmptyDoc());
});

/** Three butted 30-frame clips, each with handles on both sides. */
function setUp(): Track {
  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  loadDocument(base);

  applyEdit("setup", (d) => {
    edits.upsertAsset(d, {
      id: "a",
      name: "a.mp4",
      kind: "video",
      size: 1,
      durationSec: SOURCE_FRAMES / FPS,
      hasAudio: false,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    for (let i = 0; i < 3; i++) {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: i * 30,
        mode: "overwrite",
        inPointFrames: 60,
      });
    }
  });

  return videoTrack();
}

function videoTrack(): Track {
  return doc().tracks.find((t) => t.kind === "video")!;
}

function layout(): [number, number][] {
  return videoTrack().clips.map((c) => [c.startFrame, c.durationFrames]);
}

function clipElement(root: HTMLElement, index: number): HTMLElement {
  const element = root.querySelectorAll<HTMLElement>("[data-clip-id]")[index];
  if (!element) throw new Error(`no clip at index ${index}`);
  return element;
}

interface DragOptions {
  altKey?: boolean;
  /** Grab the left or right edge handle instead of the body. */
  edge?: "start" | "end";
}

/**
 * A full press-move-release, measured in frames.
 *
 * The grab point comes from the element's own rectangle, so the test does not
 * have to reproduce the timeline's coordinate mapping — which is one of the
 * things being tested.
 *
 * Moved in two steps because the first few pixels are swallowed by the drag
 * threshold that stops a click from becoming a one-pixel edit.
 */
function drag(element: HTMLElement, byFrames: number, options: DragOptions = {}) {
  const target = options.edge
    ? (element.querySelectorAll<HTMLElement>(":scope > div[title]")[
        options.edge === "start" ? 0 : 1
      ] ?? element)
    : element;

  const rect = target.getBoundingClientRect();
  const fromX = rect.left + rect.width / 2;
  const byPx = px(byFrames);
  const y = rect.top + rect.height / 2;

  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      clientX: fromX,
      clientY: y,
      button: 0,
      altKey: options.altKey ?? false,
    }),
  );

  for (const x of [fromX + Math.sign(byPx) * 8, fromX + byPx]) {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
        altKey: options.altKey ?? false,
      }),
    );
  }
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
}

describe("select tool", () => {
  it("trims an edge and leaves the gap", () => {
    const track = setUp();
    const root = mountLane(track);

    drag(clipElement(root, 0), -10, { edge: "end" });

    expect(layout()).toEqual([
      [0, 20],
      [30, 30],
      [60, 30],
    ]);
    assertDocValid(doc());
  });

  it("ripples the trim when Alt is held", () => {
    const track = setUp();
    const root = mountLane(track);

    drag(clipElement(root, 0), -10, { edge: "end", altKey: true });

    // No gap: everything after moved up.
    expect(layout()).toEqual([
      [0, 20],
      [20, 30],
      [50, 30],
    ]);
  });

  it("moves a clip when dragged by the body", () => {
    const track = setUp();
    const root = mountLane(track);

    // The third clip has room to the right.
    drag(clipElement(root, 2), 40);
    expect(videoTrack().clips[2].startFrame).toBeGreaterThan(60);
  });
});

describe("trim tool", () => {
  it("rolls the cut, keeping the sequence the same length", () => {
    const track = setUp();
    const root = mountLane(track);
    setSelectedTool("trim");

    const before = clipEndFrame(videoTrack().clips[2]);
    drag(clipElement(root, 0), 10, { edge: "end" });

    expect(layout()).toEqual([
      [0, 40],
      [40, 20],
      [60, 30],
    ]);
    expect(clipEndFrame(videoTrack().clips[2])).toBe(before);
  });

  it("rolls from the left edge of the clip after the cut", () => {
    // Grabbing either side of a cut should roll the same cut.
    const track = setUp();
    const root = mountLane(track);
    setSelectedTool("trim");

    drag(clipElement(root, 1), 10, { edge: "start" });

    expect(layout()).toEqual([
      [0, 40],
      [40, 20],
      [60, 30],
    ]);
  });
});

describe("slip tool", () => {
  it("changes what the clip shows without moving it", () => {
    const track = setUp();
    const root = mountLane(track);
    setSelectedTool("slip");

    const before = layout();
    drag(clipElement(root, 1), -10);

    expect(layout()).toEqual(before);
    // Dragging left shows later material, as in every other NLE.
    expect(videoTrack().clips[1].inPointFrames).toBe(70);
  });

  it("shows earlier material when dragged right", () => {
    const track = setUp();
    const root = mountLane(track);
    setSelectedTool("slip");

    drag(clipElement(root, 1), 10);
    expect(videoTrack().clips[1].inPointFrames).toBe(50);
  });
});

describe("slide tool", () => {
  it("moves the clip and lets its neighbours absorb it", () => {
    const track = setUp();
    const root = mountLane(track);
    setSelectedTool("slide");

    drag(clipElement(root, 1), 10);

    expect(layout()).toEqual([
      [0, 40],
      [40, 30],
      [70, 20],
    ]);
    // The clip itself kept its content.
    expect(videoTrack().clips[1].inPointFrames).toBe(60);
  });
});

describe("undo", () => {
  it("takes a whole drag back in one step", () => {
    // A drag applies an edit on every pointer move; if each one were its own
    // history entry, undo would rewind pixel by pixel.
    const track = setUp();
    const root = mountLane(track);
    setSelectedTool("slide");

    const before = layout();
    drag(clipElement(root, 1), 10);
    expect(layout()).not.toEqual(before);

    expect(undo()).toBe(true);
    expect(layout()).toEqual(before);
  });
});

describe("a click is not a drag", () => {
  it("leaves the document alone", () => {
    const track = setUp();
    const root = mountLane(track);
    setSelectedTool("slide");

    const before = layout();
    const entriesBefore = historyEntries().entries.length;
    const element = clipElement(root, 1);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      }),
    );
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    expect(layout()).toEqual(before);
    // Counted rather than undone: the setup itself is a history entry, so
    // `undo()` succeeding proves nothing.
    expect(historyEntries().entries.length).toBe(entriesBefore);
  });
});

describe("multi-select drag", () => {
  it("moves every selected clip together", () => {
    // Dragging one clip of a selection has to take the others with it, or a
    // multi-clip selection is decorative.
    const track = setUp();
    const root = mountLane(track);

    for (const clip of videoTrack().clips) {
      selectClip({ trackId: track.id, clipId: clip.id }, true);
    }
    expect(timelineState.selectedClips).toHaveLength(3);

    // The last clip has room to the right, so the group can shift.
    drag(clipElement(root, 2), 30);

    expect(layout()).toEqual([
      [30, 30],
      [60, 30],
      [90, 30],
    ]);
    assertDocValid(doc());
  });

  it("keeps the spacing within the group", () => {
    const track = setUp();
    const root = mountLane(track);

    // A group with a gap in it must keep the gap.
    applyEdit("gap", (d) => {
      const t = d.tracks.find((x) => x.kind === "video")!;
      edits.moveClip(d, t.id, t.clips[2].id, 120);
    });

    for (const clip of videoTrack().clips) {
      selectClip({ trackId: track.id, clipId: clip.id }, true);
    }
    drag(clipElement(root, 0), 10);

    const starts = videoTrack().clips.map((c) => c.startFrame);
    expect(starts[1] - starts[0]).toBe(30);
    expect(starts[2] - starts[1]).toBe(90);
  });

  it("moves only the grabbed clip when it is not in the selection", () => {
    // Dragging an unselected clip out of a selection is a common slip, and
    // moving five clips because of it is a nasty surprise.
    const track = setUp();
    const root = mountLane(track);

    selectClip({ trackId: track.id, clipId: videoTrack().clips[0].id });
    drag(clipElement(root, 2), 30);

    expect(layout()).toEqual([
      [0, 30],
      [30, 30],
      [90, 30],
    ]);
  });

  it("takes the whole group back in one undo", () => {
    const track = setUp();
    const root = mountLane(track);
    for (const clip of videoTrack().clips) {
      selectClip({ trackId: track.id, clipId: clip.id }, true);
    }

    const before = layout();
    drag(clipElement(root, 2), 30);
    expect(layout()).not.toEqual(before);

    expect(undo()).toBe(true);
    expect(layout()).toEqual(before);
  });
});
