import { describe, it, expect, afterEach } from "vitest";
import {
  createCompositor,
  renderFrame,
  disposeCompositor,
  currentAccumulator,
  type Compositor,
} from "@/renderer/compositor";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { resetLeakCounters } from "@/media/frame-cache";
import { clearTextCache } from "@/renderer/text-renderer";
import { loadDocument, doc, applyEdit } from "@/stores/project-store";
import { createEmptyDoc, type ProjectDoc } from "@/model/doc";
import { buildScene } from "@/renderer/scene";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { makeTestVideo } from "../fixtures/make-media";

/**
 * The features that were modelled but never drawn: opacity, transform, crop,
 * blend modes, transitions and titles. Each is verified by rendering and
 * reading pixels back, because "the data is in the document" was exactly the
 * state these were already in.
 */

const SIZE = 128;
const FRAMES = 40;
const ASSET_ID = "graph-fixture";

let fixture: Blob | null = null;
async function video(): Promise<Blob> {
  fixture ??= await makeTestVideo({
    fps: 30,
    frames: FRAMES,
    width: SIZE,
    height: SIZE,
  });
  return fixture;
}

function canvas(): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = SIZE;
  element.height = SIZE;
  return element;
}

interface Pixels {
  at: (fx: number, fy: number) => [number, number, number, number];
  meanAlpha: () => number;
  meanLuma: () => number;
}

/** Reads the finished picture. Coordinates are fractions, origin top-left. */
function readback(comp: Compositor): Pixels {
  const { gl } = comp;
  gl.bindFramebuffer(gl.FRAMEBUFFER, currentAccumulator(comp).fbo);
  const data = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, data);

  const at = (fx: number, fy: number): [number, number, number, number] => {
    const x = Math.max(0, Math.min(SIZE - 1, Math.floor(fx * SIZE)));
    // GL reads bottom-up.
    const y = Math.max(0, Math.min(SIZE - 1, Math.floor((1 - fy) * SIZE)));
    const i = (y * SIZE + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  const meanAlpha = () => {
    let total = 0;
    for (let i = 3; i < data.length; i += 4) total += data[i];
    return total / (SIZE * SIZE);
  };

  const meanLuma = () => {
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return total / (SIZE * SIZE);
  };

  return { at, meanAlpha, meanLuma };
}

async function setUp(build: (d: ProjectDoc) => void): Promise<void> {
  const blob = await video();
  await mediaEngine.openBlob(ASSET_ID, blob);

  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  base.sequence.width = SIZE;
  base.sequence.height = SIZE;
  loadDocument(base);

  applyEdit("setup", (d) => {
    edits.upsertAsset(d, {
      id: ASSET_ID,
      name: "fixture.mp4",
      kind: "video",
      size: blob.size,
      durationSec: FRAMES / 30,
      hasAudio: false,
      width: SIZE,
      height: SIZE,
    });
    build(d);
  });
}

/** Decodes the frames a render will need, since rendering never waits. */
async function warm(frame: number): Promise<void> {
  const document_ = doc();
  for (const track of document_.tracks) {
    for (const clip of track.clips) {
      (await mediaEngine.getExact(document_, clip, frame))?.release();
      // A transition reaches outside the clip's own span.
      (await mediaEngine.getExact(document_, clip, frame - 5))?.release();
    }
  }
}

function videoTrack(d: ProjectDoc, index = 0) {
  return d.tracks.filter((t) => t.kind === "video")[index];
}

afterEach(() => {
  forgetAllAssets();
  resetLeakCounters();
  clearTextCache();
  loadDocument(createEmptyDoc());
});

describe("opacity", () => {
  it("is applied rather than hardcoded to 1", async () => {
    // The composite pass passed a literal 1.0 for opacity; the clip's value
    // was never read.
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
      });
    });
    await warm(10);

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const opaque = readback(comp).meanAlpha();

    applyEdit("fade", (d) => {
      videoTrack(d).clips[0].opacity = { value: 0.25 };
    });
    renderFrame(comp, 10);
    const faded = readback(comp).meanAlpha();

    expect(opaque).toBeGreaterThan(200);
    expect(faded).toBeLessThan(opaque * 0.6);
    disposeCompositor(comp);
  });

  it("at zero leaves nothing visible", async () => {
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
        overrides: { opacity: { value: 0 } },
      });
    });
    await warm(10);

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    expect(readback(comp).meanAlpha()).toBeLessThan(4);
    disposeCompositor(comp);
  });
});

describe("layer order", () => {
  it("draws upper tracks over lower ones, right side up", async () => {
    // With two visible video tracks, alternating layers used to render
    // upside down: the quad baked a flip that one vertex shader undid and
    // another did not.
    await setUp((d) => {
      const [upper, lower] = d.tracks.filter((t) => t.kind === "video");
      edits.insertClip(d, lower.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
      });
      edits.insertClip(d, upper.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
        // Half opacity so both contribute and neither is simply hidden.
        overrides: { opacity: { value: 0.5 } },
      });
    });
    await warm(10);

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const pixels = readback(comp);

    // The fixture's marker blocks sit along the bottom; the grey field is
    // above them. If a layer were flipped the two would disagree.
    const bottom = pixels.at(0.5, 0.92);
    const middle = pixels.at(0.5, 0.4);
    expect(bottom[3]).toBeGreaterThan(200);
    expect(middle[3]).toBeGreaterThan(200);
    // Mid-frame is the flat grey field, not a marker block.
    expect(Math.abs(middle[0] - middle[1])).toBeLessThan(20);
    disposeCompositor(comp);
  });
});

describe("transform", () => {
  it("scales a layer down, leaving the rest transparent", async () => {
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
      });
    });
    await warm(10);

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const full = readback(comp).meanAlpha();

    applyEdit("scale", (d) => {
      const clip = videoTrack(d).clips[0];
      clip.transform.scaleX = { value: 0.5 };
      clip.transform.scaleY = { value: 0.5 };
    });
    renderFrame(comp, 10);
    const scaled = readback(comp);

    // A quarter of the area, so roughly a quarter of the coverage.
    expect(scaled.meanAlpha()).toBeLessThan(full * 0.5);
    // Centre still covered, corner now empty.
    expect(scaled.at(0.5, 0.5)[3]).toBeGreaterThan(200);
    expect(scaled.at(0.05, 0.05)[3]).toBeLessThan(20);
    disposeCompositor(comp);
  });

  it("moves a layer", async () => {
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
        overrides: {
          transform: {
            x: { value: 0.5 },
            y: { value: 0 },
            scaleX: { value: 0.5 },
            scaleY: { value: 0.5 },
            rotation: { value: 0 },
            anchorX: 0.5,
            anchorY: 0.5,
          },
        },
      });
    });
    await warm(10);

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const pixels = readback(comp);

    // Shifted right: covered on the right, empty on the left.
    expect(pixels.at(0.8, 0.5)[3]).toBeGreaterThan(200);
    expect(pixels.at(0.15, 0.5)[3]).toBeLessThan(20);
    disposeCompositor(comp);
  });
});

describe("crop", () => {
  it("trims the source", async () => {
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
      });
    });
    await warm(10);

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const before = readback(comp).meanLuma();

    // Crop away the marker blocks along the bottom, leaving flat grey.
    applyEdit("crop", (d) => {
      videoTrack(d).clips[0].crop.bottom = { value: 0.5 };
    });
    renderFrame(comp, 10);
    const after = readback(comp).meanLuma();

    expect(after).not.toBeCloseTo(before, 0);
    disposeCompositor(comp);
  });
});

describe("titles", () => {
  it("render, instead of being skipped", async () => {
    // Text clips had a full editor, a timeline badge and a data model, and
    // the compositor had no text path at all — the layer was dropped.
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(
        d,
        track.id,
        {
          type: "text",
          style: {
            text: "HELLO",
            fontFamily: "sans-serif",
            fontSize: 32,
            fontWeight: "bold",
            color: "#ffffff",
            x: 0.5,
            y: 0.5,
            align: "center",
          },
        },
        FRAMES,
        { startFrame: 0, mode: "overwrite" },
      );
    });

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const pixels = readback(comp);

    // White text on transparency: something bright somewhere, and the
    // corners left alone.
    expect(pixels.meanAlpha()).toBeGreaterThan(1);
    expect(pixels.at(0.02, 0.02)[3]).toBeLessThan(20);
    disposeCompositor(comp);
  });
});

describe("transitions", () => {
  it("render, instead of being stored and ignored", async () => {
    // renderTransition existed and was called from nowhere.
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, 20, {
        startFrame: 0,
        mode: "overwrite",
      });
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, 20, {
        startFrame: 20,
        mode: "overwrite",
        // Handles for the incoming side to reach back into.
        inPointFrames: 10,
      });
      edits.addTransition(
        d,
        track.id,
        track.clips[0].id,
        track.clips[1].id,
        "dip-to-black",
        8,
      );
    });

    const track = doc().tracks.filter((t) => t.kind === "video")[0];
    expect(track.transitions, "the transition should have been accepted").toHaveLength(
      1,
    );

    await warm(12);
    await warm(16);

    const comp = createCompositor(canvas())!;

    renderFrame(comp, 12); // before the transition
    const before = readback(comp).meanLuma();

    // Mid dip-to-black is the darkest point.
    renderFrame(comp, 16);
    const middle = readback(comp).meanLuma();

    expect(middle).toBeLessThan(before);
    disposeCompositor(comp);
  });
});

describe("empty scenes", () => {
  it("render transparent rather than throwing", async () => {
    await setUp(() => {
      /* no clips */
    });
    const comp = createCompositor(canvas())!;
    expect(() => renderFrame(comp, 0)).not.toThrow();
    expect(readback(comp).meanAlpha()).toBe(0);
    disposeCompositor(comp);
  });
});

describe("effects", () => {
  /**
   * A title with a background plate: a hard-edged opaque rectangle on an
   * otherwise transparent full-frame raster. Both a vertical and a horizontal
   * edge, which is what tells a one-axis smear from a real Gaussian.
   */
  function plateDoc(d: ProjectDoc) {
    const track = videoTrack(d);
    edits.insertClip(
      d,
      track.id,
      {
        type: "text",
        style: {
          text: "AB",
          fontFamily: "sans-serif",
          fontSize: 24,
          fontWeight: "bold",
          color: "#ffffff",
          backgroundColor: "#ffffff",
          x: 0.5,
          y: 0.5,
          align: "center",
        },
      },
      FRAMES,
      { startFrame: 0, mode: "overwrite" },
    );
  }

  /** Walks inward from an edge to the first opaque pixel. */
  function findEdge(p: Pixels, axis: "top" | "left"): number {
    for (let i = 0; i < SIZE; i++) {
      const f = i / SIZE;
      const alpha = axis === "top" ? p.at(0.5, f)[3] : p.at(f, 0.5)[3];
      if (alpha > 128) return f;
    }
    throw new Error(`no ${axis} edge found`);
  }

  it("blurs along both axes, not just horizontally", async () => {
    // The blur ran once, horizontally, with its direction hidden from the UI
    // and defaulted to [1,0] — a one-dimensional smear labelled "Gaussian".
    // The vertical probe is the one that failed.
    await setUp(plateDoc);

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);

    const sharp = readback(comp);
    const top = findEdge(sharp, "top");
    const left = findEdge(sharp, "left");
    // Probes just outside the plate, within the blur's reach.
    const above: [number, number] = [0.5, top - 0.05];
    const beside: [number, number] = [left - 0.05, 0.5];

    expect(sharp.at(...above)[3], "above the plate, unblurred").toBeLessThan(8);
    expect(sharp.at(...beside)[3], "beside the plate, unblurred").toBeLessThan(8);

    applyEdit("blur", (d) => {
      videoTrack(d).clips[0].effects.push({
        id: "fx",
        definitionId: "gaussian_blur",
        enabled: true,
        params: { u_radius: { value: 0.1 } },
      });
    });
    renderFrame(comp, 10);
    const blurred = readback(comp);

    expect(blurred.at(...beside)[3], "horizontal pass").toBeGreaterThan(8);
    expect(blurred.at(...above)[3], "vertical pass").toBeGreaterThan(8);
    disposeCompositor(comp);
  });

  it("renders an alpha-reducing effect identically every pass", async () => {
    // The plan expected chroma key to ghost against stale ping-pong contents.
    // It does not, and this test passes with or without the clear: `gl.BLEND`
    // is off graph-wide and each pass draws a full-coverage quad, so nothing
    // of the previous frame can survive. What is worth pinning is the property
    // that would have been violated — that repeating a render repeats the
    // picture rather than accumulating.
    await setUp((d) => {
      plateDoc(d);
      videoTrack(d).clips[0].effects.push({
        id: "fx",
        definitionId: "chroma_key",
        enabled: true,
        params: {
          // Key out the plate itself, so most of the frame turns transparent.
          u_keyColor: { value: [1, 1, 1] },
          u_threshold: { value: 0.2 },
          u_smoothing: { value: 0.05 },
        },
      });
    });

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const first = readback(comp).meanAlpha();
    // Rendering the same frame again must give the same picture. With a dirty
    // ping-pong target it accumulated instead.
    renderFrame(comp, 10);
    expect(readback(comp).meanAlpha()).toBeCloseTo(first, 1);

    // And the key must actually have removed something.
    expect(first).toBeLessThan(250);
    disposeCompositor(comp);
  });
});

describe("burned-in captions", () => {
  /** A full-frame solid, so a caption over it is unambiguous. */
  function solidDoc(d: ProjectDoc) {
    const track = videoTrack(d);
    edits.insertClip(d, track.id, { type: "solid", color: "#202020" }, FRAMES, {
      startFrame: 0,
      mode: "overwrite",
    });
  }

  it("draws the cue that covers the frame", async () => {
    // Burned in rather than overlaid, so the preview shows what the exported
    // file will contain.
    await setUp((d) => {
      solidDoc(d);
      edits.addCue(d, 0, 20, "HELLO");
    });

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const withCaption = readback(comp).meanLuma();

    renderFrame(comp, 30);
    const without = readback(comp).meanLuma();

    // The caption is white on a dark plate over a dark field; either way the
    // frame it is on must differ from the frame it is not.
    expect(Math.abs(withCaption - without)).toBeGreaterThan(0.5);
    disposeCompositor(comp);
  });

  it("draws nothing outside the cue", async () => {
    await setUp((d) => {
      solidDoc(d);
      edits.addCue(d, 0, 20, "HELLO");
    });

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 30);
    const plain = readback(comp).meanLuma();

    renderFrame(comp, 19);
    const last = readback(comp).meanLuma();
    renderFrame(comp, 20);
    const past = readback(comp).meanLuma();

    // The end frame is exclusive, like every other span in the document.
    expect(past).toBeCloseTo(plain, 1);
    expect(Math.abs(last - plain)).toBeGreaterThan(0.5);
    disposeCompositor(comp);
  });

  it("draws nothing when burn-in is off", async () => {
    await setUp((d) => {
      solidDoc(d);
      edits.addCue(d, 0, 20, "HELLO");
      edits.setBurnInSubtitles(d, false);
    });

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const off = readback(comp).meanLuma();

    applyEdit("on", (d) => edits.setBurnInSubtitles(d, true));
    renderFrame(comp, 10);
    const on = readback(comp).meanLuma();

    expect(Math.abs(on - off)).toBeGreaterThan(0.5);
    disposeCompositor(comp);
  });

  it("puts the caption low in the frame, where the style says", async () => {
    await setUp((d) => {
      solidDoc(d);
      edits.addCue(d, 0, 20, "HELLO");
    });

    const comp = createCompositor(canvas())!;
    renderFrame(comp, 10);
    const pixels = readback(comp);

    // Default style sits at 88% down the frame; the top should be untouched.
    const top = pixels.at(0.5, 0.15);
    const bottom = pixels.at(0.5, 0.88);
    expect(bottom[0]).not.toBe(top[0]);
    disposeCompositor(comp);
  });

  it("is drawn over the whole stack, including a transition", async () => {
    // Captions go on last so a crossfade cannot fade them.
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "solid", color: "#000000" }, 20, {
        startFrame: 0,
        mode: "overwrite",
      });
      edits.insertClip(d, track.id, { type: "solid", color: "#ffffff" }, 20, {
        startFrame: 20,
        mode: "overwrite",
      });
      edits.addCue(d, 0, 40, "OVER");
    });

    const scene = buildScene(doc(), 10);
    const last = scene.nodes[scene.nodes.length - 1];
    expect(last.kind).toBe("layer");
    if (last.kind === "layer") expect(last.layer.source.type).toBe("subtitle");
  });
});

describe("a frame the decoder has not caught up with", () => {
  /**
   * The preview never waits — that is what stops renders overlapping — so the
   * render pass has to have an answer for "nothing is ready yet". It used to
   * clear the accumulator up front and present regardless, which meant every
   * such pass put a black frame on screen. `renderLayer` returning false was
   * documented as leaving the accumulator "untouched"; untouched already meant
   * cleared, so the protection was illusory for a single-layer scene.
   */

  it("holds the last picture rather than presenting a hole", async () => {
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, FRAMES, {
        startFrame: 0,
        mode: "overwrite",
      });
    });

    const comp = createCompositor(canvas())!;
    await warm(10);
    expect(renderFrame(comp, 10)).toBe(true);
    const drawn = readback(comp).meanLuma();
    expect(drawn, "the fixture should render as something").toBeGreaterThan(4);

    // Nothing decoded for this pass, and nothing earlier to stand in either.
    const complete = renderFrame(comp, 20, () => null);

    expect(complete, "the pass should report that it drew nothing").toBe(false);
    expect(
      readback(comp).meanLuma(),
      "the previous picture should still be presented",
    ).toBeCloseTo(drawn, 1);

    disposeCompositor(comp);
  });

  it("still clears for a scene with nothing in it", async () => {
    // The one case where "nothing drew" does not mean "not ready yet": a gap in
    // the timeline is legitimately black, and holding the previous clip's last
    // frame across it would be worse than the bug being fixed.
    await setUp((d) => {
      const track = videoTrack(d);
      edits.insertClip(d, track.id, { type: "asset", assetId: ASSET_ID }, 20, {
        startFrame: 0,
        mode: "overwrite",
      });
    });

    const comp = createCompositor(canvas())!;
    await warm(10);
    renderFrame(comp, 10);
    expect(readback(comp).meanLuma()).toBeGreaterThan(4);

    // Past the end of the only clip.
    expect(buildScene(doc(), 30).nodes.length).toBe(0);
    expect(renderFrame(comp, 30)).toBe(true);
    expect(readback(comp).meanAlpha()).toBe(0);

    disposeCompositor(comp);
  });
});
