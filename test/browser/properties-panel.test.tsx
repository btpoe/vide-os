import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import PropertiesPanel from "@/panels/properties/PropertiesPanel";
import {
  loadDocument,
  doc,
  applyEdit,
  setPlayheadFrame,
  playheadFrame,
  undo,
} from "@/stores/project-store";
import { selectClip, clearSelection } from "@/stores/timeline-store";
import { createEmptyDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { evaluate } from "@/lib/animation";
import { FPS_30 } from "@/lib/timecode";

/**
 * Driving the real panel.
 *
 * The controls these tests exercise were previously inputs with no handler and
 * static divs reading "100%" — and the last panel bug of this kind (menus
 * showing raw command ids) was only caught by rendering the actual component.
 * Reading the store is not enough; the wiring is the thing that breaks.
 */

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

function mount(): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <PropertiesPanel />, host);
  return host;
}

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  clearSelection();
  loadDocument(createEmptyDoc());
});

const CLIP_FRAMES = 100;

function setUp(): { trackId: string; clipId: string } {
  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  loadDocument(base);

  applyEdit("setup", (d) => {
    edits.upsertAsset(d, {
      id: "a",
      name: "clip.mp4",
      kind: "video",
      size: 1000,
      durationSec: 60,
      hasAudio: true,
      width: 1920,
      height: 1080,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, CLIP_FRAMES, {
      startFrame: 0,
      mode: "overwrite",
    });
  });

  const track = doc().tracks.find((t) => t.kind === "video")!;
  const ids = { trackId: track.id, clipId: track.clips[0].id };
  selectClip(ids);
  setPlayheadFrame(0);
  return ids;
}

function clip() {
  return doc().tracks.find((t) => t.kind === "video")!.clips[0];
}

/**
 * One parameter row, found by its label.
 *
 * The whole row, not just the line the label sits on: the keyframe controls
 * live in a sibling element below it. Every control lookup is scoped to a row,
 * because the panel renders a dozen identical-looking stopwatches and picking
 * the first one in the document silently tests the wrong property.
 */
function row(root: HTMLElement, label: string): HTMLElement {
  const labels = [...root.querySelectorAll("label")];
  const match = labels.find((l) => l.textContent?.trim() === label);
  if (!match) throw new Error(`no row labelled "${label}"`);
  return match.parentElement!.parentElement!;
}

function slider(root: HTMLElement, label: string): HTMLInputElement {
  const input = row(root, label).querySelector<HTMLInputElement>('input[type="range"]');
  if (!input) throw new Error(`row "${label}" has no slider`);
  return input;
}

/** Moves a slider the way a user does, so any missing handler shows up. */
function drag(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** A button within one parameter's row. */
function button(root: HTMLElement, label: string, title: string): HTMLButtonElement {
  const found = row(root, label).querySelector<HTMLButtonElement>(
    `button[title="${title}"]`,
  );
  if (!found) throw new Error(`row "${label}" has no button titled "${title}"`);
  return found;
}

describe("rendering", () => {
  it("shows a prompt when nothing is selected", () => {
    loadDocument(createEmptyDoc());
    clearSelection();
    const root = mount();
    expect(root.textContent).toContain("Select a clip");
  });

  it("labels every transform control", () => {
    // These were the six fake controls. Labels first: a row that renders but
    // is labelled wrong is the failure mode this catches.
    setUp();
    const root = mount();
    for (const label of [
      "Position X",
      "Position Y",
      "Scale X",
      "Scale Y",
      "Rotation",
      "Opacity",
    ]) {
      expect(row(root, label), label).toBeTruthy();
    }
    expect(root.textContent).not.toContain("not wired to the renderer");
  });

  it("shows frames rather than the old seconds projection", () => {
    setUp();
    const root = mount();
    // 100 frames at 30fps is 00:00:03:10.
    expect(root.textContent).toContain("00:00:03:10");
  });
});

describe("editing", () => {
  it("writes opacity to the document", () => {
    setUp();
    const root = mount();
    drag(slider(root, "Opacity"), 40);
    expect(clip().opacity.value).toBeCloseTo(0.4, 6);
  });

  it("writes every transform axis", () => {
    setUp();
    const root = mount();

    drag(slider(root, "Position X"), 0.5);
    drag(slider(root, "Position Y"), -0.25);
    drag(slider(root, "Scale X"), 2);
    drag(slider(root, "Scale Y"), 0.5);
    drag(slider(root, "Rotation"), 90);

    const t = clip().transform;
    expect(t.x.value).toBeCloseTo(0.5, 6);
    expect(t.y.value).toBeCloseTo(-0.25, 6);
    expect(t.scaleX.value).toBeCloseTo(2, 6);
    expect(t.scaleY.value).toBeCloseTo(0.5, 6);
    expect(t.rotation.value).toBeCloseTo(90, 6);
  });

  it("writes crop as a fraction, not a percentage", () => {
    // The slider reads in percent; the model stores 0..1. Storing 25 would
    // crop the whole frame away.
    setUp();
    const root = mount();
    drag(slider(root, "Left"), 25);
    expect(clip().crop.left.value).toBeCloseTo(0.25, 6);
  });

  it("changes blend mode", () => {
    setUp();
    const root = mount();
    const select = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "screen"),
    )!;
    select.value = "screen";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(clip().blend).toBe("screen");
  });

  it("is undoable", () => {
    setUp();
    const root = mount();
    drag(slider(root, "Opacity"), 40);
    expect(undo()).toBe(true);
    expect(clip().opacity.value).toBe(1);
  });

  it("reflects a change made elsewhere", () => {
    // The panel reads the document, so an undo or a command must update it
    // without the panel being told.
    const { trackId, clipId } = setUp();
    const root = mount();
    applyEdit("external", (d) => {
      edits.setParam(d, trackId, clipId, edits.clipParamPath("opacity"), 0.2, 0);
    });
    expect(slider(root, "Opacity").value).toBe("20");
  });
});

describe("keyframing", () => {
  it("animates a property from the panel", () => {
    setUp();
    const root = mount();

    // Stopwatch on at frame 0, value 0.
    button(root, "Opacity", "Animate").click();
    drag(slider(root, "Opacity"), 0);

    // Move the playhead and set a different value: that must key, not
    // overwrite the constant.
    setPlayheadFrame(50);
    drag(slider(root, "Opacity"), 100);

    const opacity = clip().opacity;
    expect(opacity.keys).toHaveLength(2);
    expect(evaluate(opacity, 25)).toBeCloseTo(0.5, 2);
  });

  it("adds and removes a single keyframe with the diamond", () => {
    setUp();
    const root = mount();
    button(root, "Opacity", "Animate").click();

    setPlayheadFrame(30);
    button(root, "Opacity", "Add keyframe").click();
    expect(clip().opacity.keys).toHaveLength(2);

    button(root, "Opacity", "Remove keyframe").click();
    expect(clip().opacity.keys).toHaveLength(1);
  });

  it("freezes the value when animation is switched off", () => {
    setUp();
    const root = mount();

    button(root, "Opacity", "Animate").click();
    drag(slider(root, "Opacity"), 0);
    setPlayheadFrame(100);
    drag(slider(root, "Opacity"), 100);

    setPlayheadFrame(50);
    button(root, "Opacity", "Stop animating (freeze at playhead)").click();

    expect(clip().opacity.keys).toBeUndefined();
    expect(clip().opacity.value).toBeCloseTo(0.5, 2);
  });

  it("navigates between keyframes", () => {
    setUp();
    const root = mount();
    button(root, "Opacity", "Animate").click();
    setPlayheadFrame(60);
    button(root, "Opacity", "Add keyframe").click();

    setPlayheadFrame(30);
    button(root, "Opacity", "Next keyframe").click();
    expect(playheadFrame()).toBe(60);

    button(root, "Opacity", "Previous keyframe").click();
    expect(playheadFrame()).toBe(0);
  });
});
