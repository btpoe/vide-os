import { describe, it, expect, beforeEach } from "vitest";
import {
  copySelectedClips,
  cutSelectedClips,
  pasteClips,
  duplicateSelectedClips,
  rippleDeleteSelectedClips,
  hasClipboard,
} from "@/commands/clip-edits";
import {
  loadDocument,
  doc,
  applyEdit,
  setPlayheadFrame,
  undo,
} from "@/stores/project-store";
import { selectClip, clearSelection, timelineState } from "@/stores/timeline-store";
import { createEmptyDoc, type Track } from "@/model/doc";
import * as edits from "@/model/edits";
import { assertDocValid } from "@/model/invariants";
import { FPS_30 } from "@/lib/timecode";

/**
 * The clipboard commands.
 *
 * The model operations are tested separately; what these cover is the layer
 * around them — which track a paste lands on, what ends up selected
 * afterwards, and whether the whole thing is one undo step. That layer is
 * where the original app's edits went wrong.
 */

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
      durationSec: 100,
      hasAudio: false,
    });
    const track = d.tracks.find((t) => t.kind === "video")!;
    for (let i = 0; i < 3; i++) {
      edits.insertClip(d, track.id, { type: "asset", assetId: "a" }, 30, {
        startFrame: i * 30,
        mode: "overwrite",
      });
    }
  });
  return videoTrack();
}

function videoTrack(): Track {
  return doc().tracks.find((t) => t.kind === "video")!;
}

function starts(): number[] {
  return videoTrack().clips.map((c) => c.startFrame);
}

beforeEach(() => {
  clearSelection();
  loadDocument(createEmptyDoc());
});

describe("copy and paste", () => {
  it("pastes at the playhead", () => {
    const track = setUp();
    selectClip({ trackId: track.id, clipId: track.clips[0].id });
    copySelectedClips();
    expect(hasClipboard()).toBe(true);

    setPlayheadFrame(200);
    pasteClips();

    expect(starts()).toEqual([0, 30, 60, 200]);
    assertDocValid(doc());
  });

  it("selects what it pasted", () => {
    // So the obvious next move — nudge or drag it into place — needs no click.
    const track = setUp();
    selectClip({ trackId: track.id, clipId: track.clips[0].id });
    copySelectedClips();
    setPlayheadFrame(200);
    pasteClips();

    expect(timelineState.selectedClips).toHaveLength(1);
    const selected = timelineState.selectedClips[0];
    const clip = videoTrack().clips.find((c) => c.id === selected.clipId);
    expect(clip?.startFrame).toBe(200);
  });

  it("is one undo step even for several clips", () => {
    const track = setUp();
    for (const clip of track.clips) {
      selectClip({ trackId: track.id, clipId: clip.id }, true);
    }
    copySelectedClips();
    setPlayheadFrame(300);
    pasteClips();
    expect(starts()).toHaveLength(6);

    expect(undo()).toBe(true);
    expect(starts()).toEqual([0, 30, 60]);
  });

  it("survives the source clip being deleted", () => {
    // The clipboard holds a copy, so a cut-then-paste is not a use-after-free.
    const track = setUp();
    selectClip({ trackId: track.id, clipId: track.clips[1].id });
    cutSelectedClips();
    expect(starts()).toEqual([0, 60]);

    setPlayheadFrame(200);
    pasteClips();
    expect(starts()).toEqual([0, 60, 200]);
  });

  it("does nothing with an empty clipboard", () => {
    setUp();
    const before = starts();
    pasteClips();
    expect(starts()).toEqual(before);
  });
});

describe("duplicate", () => {
  it("puts the copy straight after the original", () => {
    const track = setUp();
    selectClip({ trackId: track.id, clipId: track.clips[2].id });
    duplicateSelectedClips();

    expect(starts()).toEqual([0, 30, 60, 90]);
    assertDocValid(doc());
  });
});

describe("ripple delete", () => {
  it("closes the gap it leaves", () => {
    const track = setUp();
    selectClip({ trackId: track.id, clipId: track.clips[0].id });
    rippleDeleteSelectedClips();

    expect(starts()).toEqual([0, 30]);
    assertDocValid(doc());
  });

  it("handles several clips at once without shifting them past each other", () => {
    // Removing an earlier clip moves the later ones, so a naive loop would
    // compute the second deletion against stale positions.
    const track = setUp();
    selectClip({ trackId: track.id, clipId: track.clips[0].id });
    selectClip({ trackId: track.id, clipId: track.clips[2].id }, true);
    rippleDeleteSelectedClips();

    expect(videoTrack().clips).toHaveLength(1);
    expect(starts()).toEqual([0]);
    assertDocValid(doc());
  });

  it("clears the selection, since what was selected is gone", () => {
    const track = setUp();
    selectClip({ trackId: track.id, clipId: track.clips[0].id });
    rippleDeleteSelectedClips();
    expect(timelineState.selectedClips).toHaveLength(0);
  });
});
