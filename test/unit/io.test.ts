import { describe, it, expect } from "vitest";
import { create } from "mutative";
import { strToU8 } from "fflate";
import {
  serializeDoc,
  parseDoc,
  packBundle,
  readProjectFile,
  mediaTableFromDoc,
  projectFileName,
} from "@/model/io";
import { migrate, detectVersion, UnsupportedProjectError } from "@/model/migrate";
import { createEmptyDoc, type ProjectDoc, type Asset } from "@/model/doc";
import { validateDoc } from "@/model/invariants";
import * as edits from "@/model/edits";
import { FPS_29_97, FPS_30 } from "@/lib/timecode";

function asset(id: string, durationSec = 10): Asset {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    size: 4096,
    durationSec,
    hasAudio: true,
  };
}

function sampleDoc(): ProjectDoc {
  return create(createEmptyDoc("Test Project"), (d) => {
    edits.upsertAsset(d, asset("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    const t = d.tracks.find((x) => x.kind === "video")!;
    edits.insertClip(
      d,
      t.id,
      { type: "asset", assetId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      90,
      {
        startFrame: 30,
        mode: "overwrite",
      },
    );
    edits.addMarker(d, 60, "Cut here");
  });
}

describe("round-trip", () => {
  it("survives serialize -> parse unchanged", () => {
    const doc = sampleDoc();
    const { doc: parsed, warnings } = parseDoc(serializeDoc(doc));
    expect(parsed).toEqual(doc);
    expect(warnings).toEqual([]);
  });

  it("survives a bundle round-trip", () => {
    const doc = sampleDoc();
    const bytes = packBundle({ doc, media: mediaTableFromDoc(doc) });
    const result = readProjectFile(bytes);
    expect(result.doc).toEqual(doc);
  });

  it("reads a bare project.json as well as a bundle", () => {
    // The bundle is a strict superset, so a hand-edited JSON still opens.
    const doc = sampleDoc();
    const bytes = strToU8(serializeDoc(doc));
    expect(readProjectFile(bytes).doc).toEqual(doc);
  });

  it("carries derived caches through the bundle", () => {
    const doc = sampleDoc();
    const thumb = new Uint8Array([1, 2, 3, 4]);
    const bytes = packBundle({
      doc,
      media: mediaTableFromDoc(doc),
      extras: { "thumbnails/aaa.jpg": thumb },
    });
    expect(readProjectFile(bytes).doc).toEqual(doc);
  });

  it("preserves the media table", () => {
    const doc = sampleDoc();
    const media = mediaTableFromDoc(
      doc,
      new Map([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { relPath: "media/clip.mp4" }]]),
    );
    const result = readProjectFile(packBundle({ doc, media }));
    expect(result.media.assets[0].relPath).toBe("media/clip.mp4");
    expect(result.media.assets[0].size).toBe(4096);
  });
});

describe("rejecting bad input", () => {
  it("rejects unparseable JSON with a useful message", () => {
    expect(() => parseDoc("{not json")).toThrow(/not a valid project file/i);
  });

  it("rejects a document that violates the invariants", () => {
    // The old open path assigned data.tracks straight into the store with no
    // validation, so a malformed file produced a broken editor silently.
    const doc = sampleDoc();
    const broken = JSON.parse(serializeDoc(doc)) as ProjectDoc;
    broken.tracks[0].clips[0].durationFrames = -5;
    expect(() => parseDoc(JSON.stringify(broken))).toThrow(/not valid/i);
  });

  it("rejects overlapping clips", () => {
    const doc = sampleDoc();
    const broken = JSON.parse(serializeDoc(doc)) as ProjectDoc;
    const track = broken.tracks.find((t) => t.clips.length > 0)!;
    track.clips.push({
      ...track.clips[0],
      id: "dup",
      startFrame: track.clips[0].startFrame,
    });
    expect(() => parseDoc(JSON.stringify(broken))).toThrow(/not valid/i);
  });

  it("rejects a project from a newer format version", () => {
    const doc = { ...sampleDoc(), formatVersion: 99 };
    expect(() => parseDoc(JSON.stringify(doc))).toThrow(UnsupportedProjectError);
    expect(() => parseDoc(JSON.stringify(doc))).toThrow(/newer version/i);
  });

  it("rejects a file that is not a project at all", () => {
    expect(() => parseDoc(JSON.stringify({ hello: "world" }))).toThrow(
      UnsupportedProjectError,
    );
  });

  it("rejects a corrupt bundle", () => {
    const notAZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(() => readProjectFile(notAZip)).toThrow();
  });
});

describe("version detection", () => {
  it("recognises the current format", () => {
    expect(detectVersion(sampleDoc())).toBe(3);
  });

  it("treats a versionless file with tracks as v1", () => {
    expect(detectVersion({ tracks: [], duration: 300 })).toBe(1);
  });

  it("returns 0 for anything else", () => {
    expect(detectVersion(null)).toBe(0);
    expect(detectVersion("hello")).toBe(0);
    expect(detectVersion({})).toBe(0);
  });
});

// ── v1 migration ──────────────────────────────────────────────────────

/** A file in the original `.videos.json` shape. */
const V1_FIXTURE = {
  name: "Old Project",
  duration: 300,
  fps: 29.97,
  width: 1920,
  height: 1080,
  tracks: [
    {
      id: "v1",
      name: "Video 1",
      type: "video",
      muted: false,
      locked: false,
      clips: [
        {
          id: "clip-1739822401234-0",
          mediaId: "media-1739822401234-3",
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          effects: [
            {
              id: "fx-1",
              definitionId: "brightness_contrast",
              values: { brightness: 0.2, contrast: 1.1 },
              keyframes: {
                brightness: [
                  { id: "k1", time: 0, value: 0, easing: "ease-in-out" },
                  { id: "k2", time: 1, value: 0.5, easing: "linear" },
                ],
              },
            },
          ],
        },
        {
          id: "clip-1739822401234-1",
          mediaId: "media-1739822401234-3",
          startTime: 2,
          duration: 2,
          inPoint: 5,
          outPoint: 7,
          effects: [],
          transition: { type: "crossfade", duration: 0.5 },
        },
      ],
    },
    {
      id: "a1",
      name: "Audio 1",
      type: "audio",
      muted: true,
      locked: false,
      clips: [
        {
          id: "clip-text",
          mediaId: "__text__",
          startTime: 0,
          duration: 3,
          inPoint: 0,
          outPoint: 3,
          effects: [],
          textOverlay: {
            text: "Hello",
            fontFamily: "Inter",
            fontSize: 64,
            fontWeight: "bold",
            color: "#ff0000",
            x: 0.5,
            y: 0.8,
            align: "center",
          },
        },
      ],
    },
  ],
};

describe("v1 migration", () => {
  it("produces a valid document", () => {
    const { doc } = migrate(V1_FIXTURE);
    expect(validateDoc(doc)).toEqual([]);
    expect(doc.formatVersion).toBe(3);
  });

  it("recovers 29.97 as a rational rate rather than a decimal", () => {
    const { doc } = migrate(V1_FIXTURE);
    expect(doc.sequence.frameRate).toEqual(FPS_29_97);
    expect(doc.sequence.frameRate).not.toEqual(FPS_30);
  });

  it("converts seconds to integer frames", () => {
    const { doc } = migrate(V1_FIXTURE);
    const clips = doc.tracks[0].clips;
    // 2 seconds at 29.97 is 60 frames.
    expect(clips[0].startFrame).toBe(0);
    expect(clips[0].durationFrames).toBe(60);
    expect(clips[1].startFrame).toBe(60);
    expect(clips[1].inPointFrames).toBe(150); // 5s
    expect(clips.every((c) => Number.isInteger(c.durationFrames))).toBe(true);
  });

  it("creates offline placeholder assets for unresolvable media ids", () => {
    // v1 saved no media table, so nothing referenced can be found again. The
    // honest outcome is an offline asset the user can relink, not a silent
    // black clip.
    const { doc, warnings } = migrate(V1_FIXTURE);
    expect(doc.assets).toHaveLength(1);
    expect(doc.assets[0].id).toBe("media-1739822401234-3");
    expect(doc.assets[0].problem?.kind).toBe("offline");
    expect(warnings.some((w) => /offline/i.test(w))).toBe(true);
  });

  it("converts a text clip's overlay into an inline title source", () => {
    const { doc } = migrate(V1_FIXTURE);
    const textClip = doc.tracks[1].clips[0];
    expect(textClip.source.type).toBe("text");
    if (textClip.source.type === "text") {
      expect(textClip.source.style.text).toBe("Hello");
      expect(textClip.source.style.fontSize).toBe(64);
      expect(textClip.source.style.fontWeight).toBe("bold");
    }
    // The "__text__" sentinel must not survive as an asset reference.
    expect(doc.assets.some((a) => a.id === "__text__")).toBe(false);
  });

  it("turns a clip-attached transition into an edge between two clips", () => {
    const { doc } = migrate(V1_FIXTURE);
    const track = doc.tracks[0];
    expect(track.transitions).toHaveLength(1);
    expect(track.transitions[0].leftClipId).toBe(track.clips[0].id);
    expect(track.transitions[0].rightClipId).toBe(track.clips[1].id);
    expect(track.transitions[0].type).toBe("crossfade");
  });

  it("maps easing presets onto bezier handles", () => {
    const { doc } = migrate(V1_FIXTURE);
    const params = doc.tracks[0].clips[0].effects[0].params;
    const keys = params.brightness.keys!;
    expect(keys).toHaveLength(2);
    expect(keys[0].interp).toBe("bezier");
    expect(keys[0].out).toBeDefined();
    expect(keys[1].interp).toBe("linear");
    // Keyframe times become frames too.
    expect(keys[1].timeFrames).toBe(30);
  });

  it("preserves track flags", () => {
    const { doc } = migrate(V1_FIXTURE);
    expect(doc.tracks[1].muted).toBe(true);
    expect(doc.tracks[1].kind).toBe("audio");
  });

  it("trims overlaps the old format allowed", () => {
    const overlapping = {
      ...V1_FIXTURE,
      tracks: [
        {
          ...V1_FIXTURE.tracks[0],
          clips: [
            {
              id: "a",
              mediaId: "m",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
            },
            {
              id: "b",
              mediaId: "m",
              startTime: 2,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
            },
          ],
        },
      ],
    };
    const { doc, warnings } = migrate(overlapping);
    expect(validateDoc(doc)).toEqual([]);
    expect(warnings.some((w) => /overlap/i.test(w))).toBe(true);
  });

  it("drops a transition with no clip before it, with a warning", () => {
    const orphan = {
      ...V1_FIXTURE,
      tracks: [
        {
          ...V1_FIXTURE.tracks[0],
          clips: [
            {
              id: "only",
              mediaId: "m",
              startTime: 0,
              duration: 2,
              inPoint: 0,
              outPoint: 2,
              effects: [],
              transition: { type: "crossfade", duration: 0.5 },
            },
          ],
        },
      ],
    };
    const { doc, warnings } = migrate(orphan);
    expect(doc.tracks[0].transitions).toHaveLength(0);
    expect(warnings.some((w) => /no clip before/i.test(w))).toBe(true);
  });

  it("skips zero-length clips rather than emitting an invalid document", () => {
    const zero = {
      ...V1_FIXTURE,
      tracks: [
        {
          ...V1_FIXTURE.tracks[0],
          clips: [
            {
              id: "z",
              mediaId: "m",
              startTime: 0,
              duration: 0,
              inPoint: 0,
              outPoint: 0,
              effects: [],
            },
          ],
        },
      ],
    };
    const { doc } = migrate(zero);
    expect(doc.tracks[0].clips).toHaveLength(0);
    expect(validateDoc(doc)).toEqual([]);
  });

  it("survives a v1 file missing most of its fields", () => {
    const { doc } = migrate({ tracks: [] });
    expect(validateDoc(doc)).toEqual([]);
    expect(doc.sequence.frameRate).toEqual(FPS_30);
  });

  it("round-trips after migrating", () => {
    const { doc } = migrate(V1_FIXTURE);
    expect(parseDoc(serializeDoc(doc)).doc).toEqual(doc);
  });
});

describe("file naming", () => {
  it("strips characters that break filesystems", () => {
    expect(projectFileName("My/Project: v2")).toBe("My_Project_ v2.videos");
  });

  it("falls back for an empty name", () => {
    expect(projectFileName("")).toBe("Untitled Project.videos");
    expect(projectFileName("///")).toBe("Untitled Project.videos");
  });
});
