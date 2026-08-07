import { describe, it, expect } from "vitest";
import { create } from "mutative";
import { buildScene, sceneLayers } from "@/renderer/scene";
import { createEmptyDoc, type Asset, type ProjectDoc } from "@/model/doc";
import * as edits from "@/model/edits";
import { FPS_30 } from "@/lib/timecode";

function asset(id: string, durationSec = 10): Asset {
  return { id, name: `${id}.mp4`, kind: "video", size: 1, durationSec, hasAudio: true };
}

function baseDoc(): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    d.sequence.frameRate = FPS_30;
    edits.upsertAsset(d, asset("a"));
    edits.upsertAsset(d, asset("b"));
  });
}

function videoTracks(doc: ProjectDoc) {
  return doc.tracks.filter((t) => t.kind === "video");
}

function withClip(
  doc: ProjectDoc,
  trackIndex: number,
  startFrame: number,
  durationFrames: number,
  assetId = "a",
  overrides: Parameters<typeof edits.insertClip>[4] = {},
): ProjectDoc {
  return create(doc, (d) => {
    const track = videoTracks(d)[trackIndex];
    edits.insertClip(d, track.id, { type: "asset", assetId }, durationFrames, {
      startFrame,
      mode: "overwrite",
      ...overrides,
    });
  });
}

describe("layer selection", () => {
  it("is empty for an empty timeline", () => {
    const scene = buildScene(baseDoc(), 0);
    expect(scene.nodes).toEqual([]);
    expect(scene.requests).toEqual([]);
  });

  it("includes only the clip under the playhead", () => {
    let doc = withClip(baseDoc(), 0, 0, 30);
    doc = withClip(doc, 0, 60, 30);

    expect(buildScene(doc, 15).nodes).toHaveLength(1);
    // Between the clips.
    expect(buildScene(doc, 45).nodes).toHaveLength(0);
    expect(buildScene(doc, 70).nodes).toHaveLength(1);
  });

  it("orders layers bottom to top", () => {
    // The document lists tracks top-first; compositing runs the other way.
    let doc = withClip(baseDoc(), 0, 0, 30, "a");
    doc = withClip(doc, 1, 0, 30, "b");

    const scene = buildScene(doc, 10);
    expect(scene.nodes).toHaveLength(2);

    const ids = sceneLayers(scene).map((l) =>
      l.source.type === "asset" ? l.source.assetId : "?",
    );
    // Track index 1 is lower in the document, so it is the bottom layer.
    expect(ids).toEqual(["b", "a"]);
  });

  it("skips muted tracks", () => {
    let doc = withClip(baseDoc(), 0, 0, 30);
    doc = create(doc, (d) => {
      videoTracks(d)[0].muted = true;
    });
    expect(buildScene(doc, 10).nodes).toHaveLength(0);
  });

  it("skips disabled clips", () => {
    let doc = withClip(baseDoc(), 0, 0, 30);
    doc = create(doc, (d) => {
      videoTracks(d)[0].clips[0].enabled = false;
    });
    expect(buildScene(doc, 10).nodes).toHaveLength(0);
  });

  it("ignores audio tracks", () => {
    const doc = create(baseDoc(), (d) => {
      const track = d.tracks.find((t) => t.kind === "audio")!;
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: 0,
      });
    });
    expect(buildScene(doc, 10).nodes).toHaveLength(0);
  });
});

describe("source frames", () => {
  it("maps timeline frames through the clip's in-point", () => {
    const doc = withClip(baseDoc(), 0, 100, 30, "a", { inPointFrames: 45 });
    const scene = buildScene(doc, 110);
    const layer = sceneLayers(scene)[0];
    expect(layer.source).toEqual({ type: "asset", assetId: "a", sourceFrame: 55 });
  });

  it("accounts for speed", () => {
    const doc = withClip(baseDoc(), 0, 0, 30, "a", { overrides: { speed: 2 } });
    const layer = sceneLayers(buildScene(doc, 10))[0];
    expect(layer.source).toMatchObject({ sourceFrame: 20 });
  });

  it("lists every frame the renderer will need", () => {
    let doc = withClip(baseDoc(), 0, 0, 30, "a");
    doc = withClip(doc, 1, 0, 30, "b");

    const scene = buildScene(doc, 10);
    expect(scene.requests).toHaveLength(2);
    expect(scene.requests.map((r) => r.assetId).sort()).toEqual(["a", "b"]);
  });

  it("does not request frames for text or solid layers", () => {
    const doc = create(baseDoc(), (d) => {
      const track = videoTracks(d)[0];
      edits.insertClip(
        d,
        track.id,
        {
          type: "text",
          style: {
            text: "hi",
            fontFamily: "sans-serif",
            fontSize: 24,
            fontWeight: "normal",
            color: "#fff",
            x: 0.5,
            y: 0.5,
            align: "center",
          },
        },
        30,
        { startFrame: 0 },
      );
    });
    const scene = buildScene(doc, 10);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.requests).toEqual([]);
  });
});

describe("evaluated parameters", () => {
  it("resolves animated opacity at the frame", () => {
    const doc = create(withClip(baseDoc(), 0, 0, 100), (d) => {
      videoTracks(d)[0].clips[0].opacity = {
        value: 1,
        keys: [
          { id: "k0", timeFrames: 0, value: 0, interp: "linear" },
          { id: "k1", timeFrames: 100, value: 1, interp: "linear" },
        ],
      };
    });

    expect(sceneLayers(buildScene(doc, 0))[0].opacity).toBeCloseTo(0, 6);
    expect(sceneLayers(buildScene(doc, 50))[0].opacity).toBeCloseTo(0.5, 6);
    // The clip spans [0, 100), so 99 is its last frame.
    expect(sceneLayers(buildScene(doc, 99))[0].opacity).toBeCloseTo(0.99, 6);
  });

  it("evaluates keyframes relative to the clip, not the timeline", () => {
    // A clip starting at frame 500 must reach its keyframe at *its* frame 10.
    const doc = create(withClip(baseDoc(), 0, 500, 100), (d) => {
      videoTracks(d)[0].clips[0].opacity = {
        value: 1,
        keys: [
          { id: "k0", timeFrames: 0, value: 0, interp: "linear" },
          { id: "k1", timeFrames: 10, value: 1, interp: "linear" },
        ],
      };
    });
    expect(sceneLayers(buildScene(doc, 500))[0].opacity).toBeCloseTo(0, 6);
    expect(sceneLayers(buildScene(doc, 510))[0].opacity).toBeCloseTo(1, 6);
  });

  it("clamps opacity into range", () => {
    const doc = create(withClip(baseDoc(), 0, 0, 30), (d) => {
      videoTracks(d)[0].clips[0].opacity = { value: 5 };
    });
    expect(sceneLayers(buildScene(doc, 0))[0].opacity).toBe(1);
  });

  it("resolves effect parameters", () => {
    const doc = create(withClip(baseDoc(), 0, 0, 100), (d) => {
      videoTracks(d)[0].clips[0].effects.push({
        id: "fx",
        definitionId: "brightness_contrast",
        enabled: true,
        params: {
          brightness: {
            value: 0,
            keys: [
              { id: "a", timeFrames: 0, value: 0, interp: "linear" },
              { id: "b", timeFrames: 100, value: 1, interp: "linear" },
            ],
          },
          contrast: { value: 1.5 },
        },
      });
    });

    const effects = sceneLayers(buildScene(doc, 50))[0].effects;
    expect(effects).toHaveLength(1);
    expect(effects[0].values.brightness).toBeCloseTo(0.5, 6);
    expect(effects[0].values.contrast).toBe(1.5);
  });

  it("omits disabled effects", () => {
    const doc = create(withClip(baseDoc(), 0, 0, 30), (d) => {
      videoTracks(d)[0].clips[0].effects.push({
        id: "fx",
        definitionId: "blur",
        enabled: false,
        params: {},
      });
    });
    expect(sceneLayers(buildScene(doc, 0))[0].effects).toEqual([]);
  });

  it("clamps crop so opposing edges cannot cross", () => {
    // A negative-size source rectangle would sample garbage.
    const doc = create(withClip(baseDoc(), 0, 0, 30), (d) => {
      const clip = videoTracks(d)[0].clips[0];
      clip.crop.left = { value: 0.8 };
      clip.crop.right = { value: 0.8 };
    });
    const crop = sceneLayers(buildScene(doc, 0))[0].crop;
    expect(crop.left + crop.right).toBeLessThanOrEqual(1);
  });
});

describe("transitions", () => {
  /** Two butted clips with a transition, and handles for the incoming one. */
  function docWithTransition(durationFrames = 10): ProjectDoc {
    let doc = withClip(baseDoc(), 0, 0, 50);
    doc = withClip(doc, 0, 50, 50);
    doc = create(doc, (d) => {
      // The incoming clip needs material before its in-point to reach back into.
      videoTracks(d)[0].clips[1].inPointFrames = 60;
    });
    return create(doc, (d) => {
      const track = videoTracks(d)[0];
      edits.addTransition(
        d,
        track.id,
        track.clips[0].id,
        track.clips[1].id,
        "crossfade",
        durationFrames,
      );
    });
  }

  it("emits a transition node covering the overlap", () => {
    const doc = docWithTransition(10);
    // Transition occupies the last 10 frames of the left clip: 40..50.
    expect(buildScene(doc, 39).nodes[0].kind).toBe("layer");
    expect(buildScene(doc, 40).nodes[0].kind).toBe("transition");
    expect(buildScene(doc, 49).nodes[0].kind).toBe("transition");
    expect(buildScene(doc, 50).nodes[0].kind).toBe("layer");
  });

  it("reports progress across the overlap", () => {
    const doc = docWithTransition(10);
    const at = (frame: number) => {
      const node = buildScene(doc, frame).nodes[0];
      return node.kind === "transition" ? node.progress : null;
    };
    expect(at(40)).toBeCloseTo(0, 6);
    expect(at(45)).toBeCloseTo(0.5, 6);
    expect(at(49)).toBeCloseTo(0.9, 6);
  });

  it("carries both sides", () => {
    const doc = docWithTransition(10);
    const node = buildScene(doc, 45).nodes[0];
    expect(node.kind).toBe("transition");
    if (node.kind !== "transition") return;

    expect(node.from.clipId).not.toBe(node.to.clipId);
    // Both need a frame decoded, which is why a transition needs handles.
    expect(buildScene(doc, 45).requests).toHaveLength(2);
  });

  it("reads the incoming clip from before its in-point", () => {
    // Mid-transition the outgoing clip is past its own end and the incoming
    // one has not started; both reach into their handle material.
    const doc = docWithTransition(10);
    const node = buildScene(doc, 45).nodes[0];
    if (node.kind !== "transition") throw new Error("expected a transition");

    const to = node.to.source;
    expect(to.type).toBe("asset");
    if (to.type !== "asset") return;
    // Incoming clip starts at frame 50 with in-point 60, so frame 45 is
    // source frame 55 — five frames of handle.
    expect(to.sourceFrame).toBe(55);
    expect(to.sourceFrame).toBeGreaterThanOrEqual(0);
  });
});

describe("scene shape", () => {
  it("is structured-cloneable", () => {
    // Plain data is what would let compositing move to a worker.
    const doc = withClip(baseDoc(), 0, 0, 30);
    const scene = buildScene(doc, 10);
    expect(() => structuredClone(scene)).not.toThrow();
    expect(structuredClone(scene)).toEqual(scene);
  });

  it("carries the sequence size", () => {
    const doc = create(withClip(baseDoc(), 0, 0, 30), (d) => {
      d.sequence.width = 1280;
      d.sequence.height = 720;
    });
    const scene = buildScene(doc, 0);
    expect(scene.width).toBe(1280);
    expect(scene.height).toBe(720);
    expect(scene.frame).toBe(0);
  });
});
