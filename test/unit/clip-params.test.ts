import { describe, it, expect } from "vitest";
import { create } from "mutative";
import * as edits from "@/model/edits";
import { createEmptyDoc, type Asset, type ProjectDoc, type Clip } from "@/model/doc";
import { evaluate } from "@/lib/animation";
import { FPS_30 } from "@/lib/timecode";

/**
 * The properties the panel drives. These were the six static divs: the model
 * held them, the renderer ignored them, and nothing could change them. What
 * matters here is the keyframe branch — setting a property must write a key
 * when the property is animated and a constant when it isn't, because getting
 * that backwards is invisible until someone animates something.
 */

function asset(): Asset {
  return {
    id: "a",
    name: "a.mp4",
    kind: "video",
    size: 1,
    durationSec: 100,
    hasAudio: true,
  };
}

function docWithClip(startFrame = 0): ProjectDoc {
  return create(createEmptyDoc(), (d) => {
    d.sequence.frameRate = FPS_30;
    edits.upsertAsset(d, asset());
    const track = d.tracks.find((t) => t.kind === "video")!;
    edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 100, {
      startFrame,
      mode: "overwrite",
    });
  });
}

function ids(doc: ProjectDoc): { trackId: string; clipId: string } {
  const track = doc.tracks.find((t) => t.kind === "video")!;
  return { trackId: track.id, clipId: track.clips[0].id };
}

/** Shorthand: a clip-property target. */
const P = edits.clipParamPath;

function clip(doc: ProjectDoc): Clip {
  return doc.tracks.find((t) => t.kind === "video")!.clips[0];
}

describe("reading", () => {
  it("addresses every animatable property by path", () => {
    const doc = docWithClip();
    for (const path of edits.CLIP_PARAM_PATHS) {
      expect(edits.paramOf(clip(doc), P(path)), path).toBeDefined();
    }
  });

  it("evaluates at the frame, relative to the clip", () => {
    // A clip at frame 500 must reach its own frame 10 at timeline frame 510.
    const doc = create(docWithClip(500), (d) => {
      clip(d).opacity = {
        value: 1,
        keys: [
          { id: "k0", timeFrames: 0, value: 0, interp: "linear" },
          { id: "k1", timeFrames: 10, value: 1, interp: "linear" },
        ],
      };
    });
    expect(edits.paramValueAt(clip(doc), P("opacity"), 500)).toBeCloseTo(0, 6);
    expect(edits.paramValueAt(clip(doc), P("opacity"), 505)).toBeCloseTo(0.5, 6);
    expect(edits.paramValueAt(clip(doc), P("opacity"), 510)).toBeCloseTo(1, 6);
  });
});

describe("setting", () => {
  it("changes the constant when the property is not animated", () => {
    const base = docWithClip();
    const { trackId, clipId } = ids(base);
    const doc = create(base, (d) => {
      edits.setParam(d, trackId, clipId, P("transform.scaleX"), 1.5, 40);
    });

    expect(clip(doc).transform.scaleX.value).toBe(1.5);
    expect(clip(doc).transform.scaleX.keys).toBeUndefined();
  });

  it("writes a keyframe when the property is animated", () => {
    // Changing the base value of an animated property changes nothing on
    // screen — the keys win. Silently doing that is the bug this prevents.
    let doc = docWithClip();
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      edits.addParamKey(d, trackId, clipId, P("opacity"), 0);
      edits.setParam(d, trackId, clipId, P("opacity"), 0.25, 40);
    });

    const opacity = clip(doc).opacity;
    expect(opacity.keys).toHaveLength(2);
    expect(evaluate(opacity, 40)).toBeCloseTo(0.25, 6);
  });

  it("moves an existing key rather than stacking a second one on the frame", () => {
    let doc = docWithClip();
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      edits.addParamKey(d, trackId, clipId, P("opacity"), 10);
      edits.setParam(d, trackId, clipId, P("opacity"), 0.3, 10);
      edits.setParam(d, trackId, clipId, P("opacity"), 0.6, 10);
    });

    expect(clip(doc).opacity.keys).toHaveLength(1);
    expect(clip(doc).opacity.keys![0].value).toBe(0.6);
  });

  it("keeps keys sorted", () => {
    let doc = docWithClip();
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      edits.addParamKey(d, trackId, clipId, P("opacity"), 0);
      for (const frame of [50, 10, 30, 20]) {
        edits.setParam(d, trackId, clipId, P("opacity"), 0.5, frame);
      }
    });

    const times = clip(doc).opacity.keys!.map((k) => k.timeFrames);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("inherits the previous key's interpolation", () => {
    // Adding a key in the middle of a hold must not turn it into a ramp.
    let doc = docWithClip();
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      edits.addParamKey(d, trackId, clipId, P("opacity"), 0, "hold");
      edits.setParam(d, trackId, clipId, P("opacity"), 0.5, 20);
    });

    const keys = clip(doc).opacity.keys!;
    expect(keys[1].interp).toBe("hold");
  });
});

describe("animation on and off", () => {
  it("captures the current value, so turning it on changes nothing", () => {
    let doc = create(docWithClip(), (d) => {
      clip(d).transform.rotation.value = 42;
    });
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      edits.addParamKey(d, trackId, clipId, P("transform.rotation"), 30);
    });

    expect(edits.paramValueAt(clip(doc), P("transform.rotation"), 30)).toBe(42);
    expect(edits.paramValueAt(clip(doc), P("transform.rotation"), 0)).toBe(42);
  });

  it("freezes at the playhead when animation is removed", () => {
    // Reverting to the base value would move the picture the moment the
    // stopwatch is switched off, which is not what anyone means by it.
    let doc = docWithClip();
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      const c = clip(d);
      c.opacity = {
        value: 1,
        keys: [
          { id: "k0", timeFrames: 0, value: 0, interp: "linear" },
          { id: "k1", timeFrames: 100, value: 1, interp: "linear" },
        ],
      };
      edits.clearParamKeys(d, trackId, clipId, P("opacity"), 25);
    });

    expect(clip(doc).opacity.keys).toBeUndefined();
    expect(clip(doc).opacity.value).toBeCloseTo(0.25, 6);
  });

  it("drops the key list entirely when the last key is removed", () => {
    // An empty `keys` array still reads as animated, which leaves the
    // stopwatch lit with nothing to show.
    let doc = docWithClip();
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      edits.addParamKey(d, trackId, clipId, P("opacity"), 0);
    });
    const keyId = clip(doc).opacity.keys![0].id;
    doc = create(doc, (d) => {
      edits.removeParamKey(d, trackId, clipId, P("opacity"), keyId);
    });

    expect(clip(doc).opacity.keys).toBeUndefined();
  });
});

describe("easing", () => {
  it("stores bezier handles alongside the mode", () => {
    let doc = docWithClip();
    const { trackId, clipId } = ids(doc);
    doc = create(doc, (d) => {
      edits.addParamKey(d, trackId, clipId, P("opacity"), 0);
    });
    const keyId = clip(doc).opacity.keys![0].id;
    doc = create(doc, (d) => {
      edits.setParamKeyInterp(d, trackId, clipId, P("opacity"), keyId, "bezier", {
        out: [0.42, 0],
        in: [0.58, 1],
      });
    });

    const key = clip(doc).opacity.keys![0];
    expect(key.interp).toBe("bezier");
    expect(key.out).toEqual([0.42, 0]);
    expect(key.in).toEqual([0.58, 1]);
  });
});

describe("plain settings", () => {
  it("patches only what it is given", () => {
    const base = docWithClip();
    const { trackId, clipId } = ids(base);
    const doc = create(base, (d) => {
      edits.setClipSettings(d, trackId, clipId, { blend: "screen", anchorX: 0.25 });
    });

    expect(clip(doc).blend).toBe("screen");
    expect(clip(doc).transform.anchorX).toBe(0.25);
    expect(clip(doc).fit).toBe(clip(base).fit);
    expect(clip(doc).enabled).toBe(true);
  });
});

describe("missing clips", () => {
  it("are a no-op rather than a throw", () => {
    // The panel can hold a reference to a clip that has just been deleted.
    const base = docWithClip();
    const { trackId } = ids(base);
    expect(() =>
      create(base, (d) => {
        edits.setParam(d, trackId, "gone", P("opacity"), 0.5, 0);
        edits.addParamKey(d, "gone", "gone", P("opacity"), 0);
        edits.clearParamKeys(d, trackId, "gone", P("opacity"), 0);
        edits.setClipSettings(d, trackId, "gone", { blend: "add" });
      }),
    ).not.toThrow();
  });
});

describe("effect parameters", () => {
  /** Effect uniforms are the same kind of thing as clip properties. */
  function withEffect(): {
    doc: ProjectDoc;
    trackId: string;
    clipId: string;
    target: edits.ParamTarget;
  } {
    const base = docWithClip();
    const { trackId, clipId } = ids(base);
    const doc = create(base, (d) => {
      clip(d).effects.push({
        id: "fx",
        definitionId: "gaussian_blur",
        enabled: true,
        params: { u_radius: { value: 0.02 } },
      });
    });
    return { doc, trackId, clipId, target: edits.effectParam("fx", "u_radius") };
  }

  it("reads and writes through the same operations", () => {
    const { doc: base, trackId, clipId, target } = withEffect();
    const doc = create(base, (d) => {
      edits.setParam(d, trackId, clipId, target, 0.09, 0);
    });
    expect(edits.paramValueAt(clip(doc), target, 0)).toBe(0.09);
  });

  it("keyframes like any other parameter", () => {
    const { doc: base, trackId, clipId, target } = withEffect();
    const doc = create(base, (d) => {
      edits.addParamKey(d, trackId, clipId, target, 0);
      edits.setParam(d, trackId, clipId, target, 0.1, 50);
    });
    expect(edits.paramValueAt(clip(doc), target, 25)).toBeCloseTo(0.06, 6);
  });

  it("is a no-op for an effect that has been removed", () => {
    const { doc: base, trackId, clipId } = withEffect();
    const gone = edits.effectParam("no-such-effect", "u_radius");
    expect(edits.paramOf(clip(base), gone)).toBeUndefined();
    expect(() =>
      create(base, (d) => {
        edits.setParam(d, trackId, clipId, gone, 1, 0);
        edits.addParamKey(d, trackId, clipId, gone, 0);
      }),
    ).not.toThrow();
  });

  it("reorders the chain, because order changes the picture", () => {
    const base = create(docWithClip(), (d) => {
      clip(d).effects.push(
        { id: "a", definitionId: "gaussian_blur", enabled: true, params: {} },
        { id: "b", definitionId: "saturation", enabled: true, params: {} },
        { id: "c", definitionId: "vignette", enabled: true, params: {} },
      );
    });
    const { trackId, clipId } = ids(base);
    const doc = create(base, (d) => {
      edits.moveEffect(d, trackId, clipId, "c", 0);
    });
    expect(clip(doc).effects.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

describe("clipboard", () => {
  function twoTracks(): {
    doc: ProjectDoc;
    videoId: string;
    audioId: string;
  } {
    const base = create(createEmptyDoc(), (d) => {
      d.sequence.frameRate = FPS_30;
      edits.upsertAsset(d, asset());
      edits.upsertAsset(d, {
        id: "music",
        name: "music.mp3",
        kind: "audio",
        size: 1,
        durationSec: 100,
        hasAudio: true,
      });
      const video = d.tracks.find((t) => t.kind === "video")!;
      const audio = d.tracks.find((t) => t.kind === "audio")!;
      edits.insertClip(d, video.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: 10,
        mode: "overwrite",
      });
      edits.insertClip(d, audio.id, { type: "asset", assetId: "music" }, 30, {
        startFrame: 25,
        mode: "overwrite",
      });
    });
    return {
      doc: base,
      videoId: base.tracks.find((t) => t.kind === "video")!.id,
      audioId: base.tracks.find((t) => t.kind === "audio")!.id,
    };
  }

  function refsOf(doc: ProjectDoc) {
    return doc.tracks.flatMap((t) =>
      t.clips.map((c) => ({ trackId: t.id, clipId: c.id })),
    );
  }

  it("keeps the shape of a group when pasted elsewhere", () => {
    // The second clip starts 15 frames after the first; pasting at frame 100
    // must preserve that, not stack them.
    const { doc: base, videoId } = twoTracks();
    const contents = edits.copyClips(base, refsOf(base))!;

    const pasted = create(base, (d) => {
      edits.pasteClips(d, contents, videoId, 100);
    });

    const video = pasted.tracks.find((t) => t.kind === "video")!;
    const audio = pasted.tracks.find((t) => t.kind === "audio")!;
    expect(video.clips.map((c) => c.startFrame)).toEqual([10, 100]);
    expect(audio.clips.map((c) => c.startFrame)).toEqual([25, 115]);
  });

  it("gives pasted clips new ids", () => {
    // Two clips sharing an id would make every later edit ambiguous.
    const { doc: base, videoId } = twoTracks();
    const contents = edits.copyClips(base, refsOf(base))!;
    const pasted = create(base, (d) => {
      edits.pasteClips(d, contents, videoId, 100);
    });

    const ids = pasted.tracks.flatMap((t) => t.clips.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries effects and keyframes along", () => {
    const { doc: withFx, videoId } = twoTracks();
    const base = create(withFx, (d) => {
      const clip = d.tracks.find((t) => t.kind === "video")!.clips[0];
      clip.opacity = {
        value: 1,
        keys: [{ id: "k", timeFrames: 5, value: 0.5, interp: "linear" }],
      };
      clip.effects.push({
        id: "fx",
        definitionId: "gaussian_blur",
        enabled: true,
        params: { u_radius: { value: 0.05 } },
      });
    });

    const contents = edits.copyClips(base, [
      { trackId: videoId, clipId: base.tracks[0].clips[0].id },
    ])!;
    const pasted = create(base, (d) => {
      edits.pasteClips(d, contents, videoId, 100);
    });

    const copy = pasted.tracks
      .find((t) => t.kind === "video")!
      .clips.find((c) => c.startFrame === 100)!;
    expect(copy.effects[0].params.u_radius.value).toBe(0.05);
    // Keyframes are clip-relative, so they land in the same place within it.
    expect(copy.opacity.keys![0].timeFrames).toBe(5);
    // Fresh ids inside, so the copy and the original are never confusable.
    expect(copy.effects[0].id).not.toBe("fx");
    expect(copy.opacity.keys![0].id).not.toBe("k");
  });

  it("does not paste a video clip onto an audio track", () => {
    // The source would resolve, and nothing would ever draw it.
    const { doc: base, videoId, audioId } = twoTracks();
    const contents = edits.copyClips(base, [
      { trackId: videoId, clipId: base.tracks[0].clips[0].id },
    ])!;

    const pasted = create(base, (d) => {
      edits.pasteClips(d, contents, audioId, 100);
    });
    const audio = pasted.tracks.find((t) => t.kind === "audio")!;
    expect(audio.clips).toHaveLength(1);
  });

  it("is unaffected by later edits to the document", () => {
    // The clipboard holds a copy, not a reference into the document.
    const { doc: base, videoId } = twoTracks();
    const clipId = base.tracks[0].clips[0].id;
    const contents = edits.copyClips(base, [{ trackId: videoId, clipId }])!;

    const changed = create(base, (d) => {
      edits.removeClip(d, videoId, clipId);
    });
    const pasted = create(changed, (d) => {
      edits.pasteClips(d, contents, videoId, 100);
    });

    expect(
      pasted.tracks.find((t) => t.kind === "video")!.clips.map((c) => c.startFrame),
    ).toEqual([100]);
  });

  it("duplicates each clip directly after itself", () => {
    const { doc: base, videoId } = twoTracks();
    const clipId = base.tracks[0].clips[0].id;
    const doubled = create(base, (d) => {
      edits.duplicateClips(d, [{ trackId: videoId, clipId }]);
    });

    const clips = doubled.tracks.find((t) => t.kind === "video")!.clips;
    expect(clips.map((c) => c.startFrame)).toEqual([10, 40]);
  });
});
