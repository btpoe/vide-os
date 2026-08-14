import { describe, it, expect } from "vitest";
import { create } from "mutative";
import { buildScene } from "@/renderer/scene";
import { createEmptyDoc, type ProjectDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";
import { BUDGET_MS, budgetFor, measure } from "./budgets";

/**
 * The scene builder's budget.
 *
 * It runs once per rendered frame, on the main thread, before anything can be
 * drawn — so whatever it costs is subtracted from the frame budget of every
 * preview frame and every exported frame alike. A thousand clips is a long
 * documentary timeline, not a stress test.
 *
 * The shape of the document matters as much as the count: clips are spread
 * across four video tracks with keyframed opacity and an effect on every
 * fourth, because a builder that is fast on bare clips and slow on animated
 * parameters is slow on real projects.
 */

const CLIPS = 1000;
const CLIP_FRAMES = 30;

function bigDoc(): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    d.sequence.frameRate = FPS_30;
    edits.upsertAsset(d, {
      id: "asset",
      name: "asset.mp4",
      kind: "video",
      size: 1,
      durationSec: 3600,
      hasAudio: true,
    });

    // Two more video tracks, so four in total.
    edits.addTrack(d, "video", "Video 3");
    edits.addTrack(d, "video", "Video 4");
    const tracks = d.tracks.filter((t) => t.kind === "video");

    for (let i = 0; i < CLIPS; i++) {
      const track = tracks[i % tracks.length];
      // Laid end to end per track, so every frame of the timeline has one clip
      // on each track and the builder cannot get away with an early exit.
      const startFrame = Math.floor(i / tracks.length) * CLIP_FRAMES;
      const clip = edits.insertClip(
        d,
        track.id,
        { type: "asset", assetId: "asset" },
        CLIP_FRAMES,
        { startFrame, mode: "overwrite" },
      );
      if (!clip) throw new Error("the fixture failed to build");

      clip.opacity = {
        value: 1,
        keys: [
          { id: `k-${i}-a`, timeFrames: 0, value: 0, interp: "linear" },
          { id: `k-${i}-b`, timeFrames: CLIP_FRAMES, value: 1, interp: "bezier" },
        ],
      };
      if (i % 4 === 0) {
        clip.effects = [
          {
            id: `fx-${i}`,
            definitionId: "gaussian_blur",
            enabled: true,
            params: { u_radius: { value: 0.02 } },
          },
        ];
      }
    }
  });
}

describe("scene building", () => {
  it("builds the timeline the budget claims to be measuring", () => {
    // A budget met by a document that turned out to be empty is worse than no
    // budget, because it reports success. This is what the numbers below mean.
    const doc = bigDoc();
    const total = doc.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    expect(total).toBe(CLIPS);

    const scene = buildScene(doc, CLIP_FRAMES * 100 + 5);
    expect(scene.nodes).toHaveLength(4);
    expect(scene.requests.length).toBeGreaterThan(0);
  });

  it(`stays under ${BUDGET_MS.sceneBuild} ms at ${CLIPS} clips`, () => {
    const doc = bigDoc();
    const lastFrame = Math.ceil(CLIPS / 4) * CLIP_FRAMES;

    // Across the whole timeline rather than at one position: a build at frame 0
    // reaches the clips it wants immediately, and would hide a scan that gets
    // slower the further along the playhead is.
    const timing = measure(200, (run) => {
      buildScene(doc, Math.floor((run * lastFrame) / 200));
    });

    const budget = budgetFor(
      `scene build @ ${CLIPS} clips`,
      BUDGET_MS.sceneBuild,
      timing,
    );
    expect(timing.median).toBeLessThan(budget);
  });

  it("does not get slower the further along the timeline the playhead is", () => {
    // The regression this is really guarding against is a linear scan creeping
    // back in. A build at the end of a 1000-clip timeline costing several times
    // one at the start is that scan, whatever the absolute numbers say.
    const doc = bigDoc();
    const lastFrame = Math.ceil(CLIPS / 4) * CLIP_FRAMES;

    const atStart = measure(100, () => buildScene(doc, 5));
    const atEnd = measure(100, () => buildScene(doc, lastFrame - 5));

    console.log(
      `[perf] scene build: ${atStart.median.toFixed(3)} ms at the start, ` +
        `${atEnd.median.toFixed(3)} ms at the end`,
    );
    // Generous, because both numbers are small enough that timer resolution is
    // a real part of the ratio. It is the order of magnitude that matters.
    expect(atEnd.median).toBeLessThan(Math.max(atStart.median * 8, 0.05));
  });
});
