import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render } from "solid-js/web";
import MarkerLane from "@/panels/timeline/MarkerLane";
import MarkersPanel from "@/panels/MarkersPanel";
import {
  loadDocument,
  doc,
  applyEdit,
  setPlayheadFrame,
  playheadFrame,
  addMarkerAtPlayhead,
  undo,
} from "@/stores/project-store";
import {
  setViewportWidth,
  setScrollLeft,
  zoomToFrameRange,
  timelineView,
} from "@/stores/timeline-view-store";
import { createEmptyDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";

/**
 * Markers, driven through the DOM.
 *
 * The model has had markers since Phase 1 and nothing ever showed them. These
 * cover the parts that only exist in the UI: that a pin lands where the
 * timeline says it should, that dragging one moves it, and that editing a name
 * in the list does not turn every keystroke into its own undo step.
 */

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

function mount(component: () => unknown, asStrip = false): HTMLElement {
  host = document.createElement("div");
  if (asStrip) host.setAttribute("data-timeline-strip", "");
  host.style.cssText = "position:fixed;left:0;top:0;width:900px;height:200px";
  document.body.append(host);
  dispose = render(component as never, host);
  return host;
}

beforeEach(() => {
  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  loadDocument(base);
  setViewportWidth(900);
  setScrollLeft(0);
  zoomToFrameRange(0, 300);
  setPlayheadFrame(0);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  loadDocument(createEmptyDoc());
});

function addMarkers(entries: { frame: number; name?: string }[]): void {
  applyEdit("markers", (d) => {
    for (const entry of entries) edits.addMarker(d, entry.frame, entry.name ?? "");
  });
}

function pins(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[title]")].filter((element) =>
    element.classList.contains("cursor-ew-resize"),
  );
}

describe("the lane", () => {
  it("shows a pin for every marker", () => {
    addMarkers([{ frame: 0 }, { frame: 100 }, { frame: 200 }]);
    const root = mount(() => <MarkerLane />, true);
    expect(pins(root)).toHaveLength(3);
  });

  it("puts each pin where the timeline says it goes", () => {
    addMarkers([{ frame: 0 }, { frame: 100 }]);
    const root = mount(() => <MarkerLane />, true);

    // The inline offset, not the rendered rectangle: browser-mode tests load
    // no stylesheet, so the Tailwind `absolute` never applies and every
    // element measures at the origin. What matters is the number the geometry
    // produced.
    const [first, second] = pins(root).map((p) => parseFloat(p.style.left));
    expect(second - first).toBeCloseTo(100 * timelineView().pxPerFrame, 3);
  });

  it("shows the name beside the pin", () => {
    addMarkers([{ frame: 50, name: "Cutaway" }]);
    const root = mount(() => <MarkerLane />, true);
    expect(root.textContent).toContain("Cutaway");
  });

  it("moves a marker when its pin is dragged", () => {
    addMarkers([{ frame: 100, name: "Beat" }]);
    const root = mount(() => <MarkerLane />, true);

    const pin = pins(root)[0];
    const rect = pin.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const byPx = 30 * timelineView().pxPerFrame;

    pin.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        clientX: startX,
        clientY: rect.top + 4,
        button: 0,
      }),
    );
    for (const x of [startX + 8, startX + byPx]) {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: x,
          clientY: rect.top + 4,
        }),
      );
    }
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    expect(doc().markers[0].frame).toBe(130);
  });

  it("takes the whole drag back in one undo", () => {
    addMarkers([{ frame: 100 }]);
    const root = mount(() => <MarkerLane />, true);

    const pin = pins(root)[0];
    const rect = pin.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;

    pin.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        clientX: startX,
        clientY: rect.top + 4,
        button: 0,
      }),
    );
    for (let i = 1; i <= 6; i++) {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: startX + i * 8,
          clientY: rect.top + 4,
        }),
      );
    }
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    expect(doc().markers[0].frame).not.toBe(100);
    expect(undo()).toBe(true);
    expect(doc().markers[0].frame).toBe(100);
  });
});

describe("the list", () => {
  it("prompts when there is nothing to show", () => {
    const root = mount(() => <MarkersPanel />);
    expect(root.textContent).toContain("No markers yet");
  });

  it("lists markers with their timecode, in order", () => {
    addMarkers([
      { frame: 300, name: "Later" },
      { frame: 30, name: "Earlier" },
    ]);
    const root = mount(() => <MarkersPanel />);

    // Names are input values, which `textContent` does not include.
    const names = [
      ...root.querySelectorAll<HTMLInputElement>('input[type="text"]'),
    ].map((input) => input.value);
    expect(names).toEqual(["Earlier", "Later"]);
    expect(root.textContent).toContain("00:00:01:00");
    expect(root.textContent).toContain("00:00:10:00");
  });

  it("adds a marker at the playhead", () => {
    setPlayheadFrame(45);
    const root = mount(() => <MarkersPanel />);

    const button = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Marker"),
    )!;
    button.click();

    expect(doc().markers).toHaveLength(1);
    expect(doc().markers[0].frame).toBe(45);
  });

  it("seeks when a row is clicked", () => {
    addMarkers([{ frame: 240, name: "Go here" }]);
    const root = mount(() => <MarkersPanel />);

    const row = [...root.querySelectorAll<HTMLElement>("div")].find((d) =>
      d.className.includes("group"),
    )!;
    row.click();

    expect(playheadFrame()).toBe(240);
  });

  it("renames without one history entry per keystroke", () => {
    // Coalescing is the difference between undo taking a name back and undo
    // taking one letter back.
    addMarkers([{ frame: 0 }]);
    const root = mount(() => <MarkersPanel />);

    const input = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    for (const value of ["S", "Sc", "Sce", "Scene"]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // Still the same element: a row rebuilt mid-word would take the caret
    // with it, which is what iterating marker objects rather than ids did.
    expect(input.isConnected, "the row should survive an edit").toBe(true);
    expect(doc().markers[0].name).toBe("Scene");

    expect(undo()).toBe(true);
    expect(doc().markers[0].name).toBe("");
  });

  it("exports the markers it is showing", () => {
    addMarkers([
      { frame: 0, name: "Cold open" },
      { frame: 300, name: "Titles" },
    ]);
    const root = mount(() => <MarkersPanel />);

    [...root.querySelectorAll("button")]
      .find((b) => b.textContent === "Export")!
      .click();

    const textarea = root.querySelector("textarea")!;
    expect(textarea.value).toContain("0:00 Cold open");
    expect(textarea.value).toContain("0:10 Titles");
  });
});

describe("the command", () => {
  it("drops a marker at the playhead", () => {
    setPlayheadFrame(90);
    const id = addMarkerAtPlayhead("Note");
    expect(id).not.toBe("");
    expect(doc().markers[0]).toMatchObject({ frame: 90, name: "Note" });
  });
});
