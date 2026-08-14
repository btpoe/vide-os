import { describe, it, expect, afterEach } from "vitest";
import {
  createCompositor,
  disposeCompositor,
  renderFrame,
  settleFrame,
  type Compositor,
} from "@/renderer/compositor";
import { loadDocument, applyEdit } from "@/stores/project-store";
import { createEmptyDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { mediaEngine } from "@/media/engine";
import { forgetAllAssets } from "@/media/asset-registry";
import { resetLeakCounters } from "@/media/frame-cache";
import { makeTestVideo } from "../fixtures/make-media";
import { BUDGET_MS, budgetFor, measure } from "../perf/budgets";

/**
 * The preview frame budget: a whole frame, at half of 1080p, inside a display
 * frame.
 *
 * Everything the real loop does per frame except the waiting — build the scene,
 * look up decoded frames, upload, run the effect passes, composite, present —
 * measured on a 1920×1080 sequence at the 960×540 the preview actually renders.
 *
 * `gl.finish()` is inside the measured region on purpose. Without it this
 * measures how long it takes to *submit* the frame, which is the same mistake
 * the quality ladder had to be given a second signal to work around: GL calls
 * return promptly and the GPU finishes whenever it finishes. A budget measuring
 * submission would sit at a comfortable 1 ms while the preview stuttered.
 *
 * On CI there is no GPU at all — Chromium falls back to software rasterization,
 * where this is several times slower for reasons that have nothing to do with
 * the code under test. That is what `VITE_PERF_ALLOWANCE` is for, and it is set
 * in the workflow rather than here so a local run measures the real budget.
 */

const SEQUENCE = { width: 1920, height: 1080 };
const PREVIEW = { width: 960, height: 540 };
const SOURCE = 256;
const FRAMES = 30;
const ASSET_ID = "perf-fixture";

let compositor: Compositor | null = null;
let canvas: HTMLCanvasElement | null = null;

async function setUp(effects: boolean): Promise<void> {
  const blob = await makeTestVideo({
    fps: 30,
    frames: FRAMES,
    width: SOURCE,
    height: SOURCE,
  });
  await mediaEngine.openBlob(ASSET_ID, blob);

  const base = createEmptyDoc();
  base.sequence.frameRate = FPS_30;
  base.sequence.width = SEQUENCE.width;
  base.sequence.height = SEQUENCE.height;
  loadDocument(base);

  applyEdit("perf setup", (d) => {
    edits.upsertAsset(d, {
      id: ASSET_ID,
      name: "fixture.mp4",
      kind: "video",
      size: blob.size,
      durationSec: FRAMES / 30,
      hasAudio: false,
      width: SOURCE,
      height: SOURCE,
    });

    // Two layers, because one is not a composite. The upper one carries the
    // effect chain when asked for.
    for (const track of d.tracks.filter((t) => t.kind === "video").slice(0, 2)) {
      const clip = edits.insertClip(
        d,
        track.id,
        { type: "asset", assetId: ASSET_ID },
        FRAMES,
        { startFrame: 0, mode: "overwrite" },
      );
      if (!clip) throw new Error("the fixture failed to build");
      clip.opacity = { value: 0.8 };
    }

    if (effects) {
      const top = d.tracks.filter((t) => t.kind === "video")[0];
      top.clips[0].effects = [
        {
          id: "fx",
          definitionId: "gaussian_blur",
          enabled: true,
          params: { u_radius: { value: 0.02 } },
        },
      ];
    }
  });
}

/** A compositor at the preview's render size, off-screen. */
function startCompositor(): Compositor {
  canvas = document.createElement("canvas");
  canvas.width = PREVIEW.width;
  canvas.height = PREVIEW.height;
  const comp = createCompositor(canvas, PREVIEW)!;
  compositor = comp;
  return comp;
}

/** Decodes every frame the measurement will ask for, so none of it is waiting. */
async function warmCache(): Promise<void> {
  for (let frame = 0; frame < FRAMES; frame++) await settleFrame(frame);
}

afterEach(() => {
  if (compositor) disposeCompositor(compositor);
  compositor = null;
  canvas?.remove();
  canvas = null;
  forgetAllAssets();
  resetLeakCounters();
  loadDocument(createEmptyDoc());
});

describe("a preview frame at half resolution", () => {
  it(`composites two layers inside ${BUDGET_MS.previewFrame.toFixed(1)} ms`, async () => {
    await setUp(false);
    const comp = startCompositor();
    await warmCache();

    const timing = measure(120, (run) => {
      renderFrame(comp, run % FRAMES);
      // Waits for the GPU. See the note at the top — without this the budget
      // measures submission and passes however slow the preview really is.
      comp.gl.finish();
    });

    const budget = budgetFor(
      "preview frame, two layers",
      BUDGET_MS.previewFrame,
      timing,
    );
    expect(timing.median).toBeLessThan(budget);
  });

  it("stays inside it with an effect pass in the chain", async () => {
    // A separable blur is two full-frame passes through a ping-pong FBO, which
    // is where a preview that was comfortable stops being comfortable.
    await setUp(true);
    const comp = startCompositor();
    await warmCache();

    const timing = measure(120, (run) => {
      renderFrame(comp, run % FRAMES);
      comp.gl.finish();
    });

    const budget = budgetFor("preview frame, blurred", BUDGET_MS.previewFrame, timing);
    expect(timing.median).toBeLessThan(budget);
  });
});
