import { Component } from "solid-js";
import {
  doc,
  playheadFrame,
  addTrack,
  sequenceFrameRate,
} from "@/stores/project-store";
import { timelineState, toggleSnap } from "@/stores/timeline-store";
import {
  pxPerSecond,
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToFrameLevel,
} from "@/stores/timeline-view-store";
import { framesToTimecode } from "@/lib/timecode";
import { contentEndFrame } from "@/model/doc";

const Button: Component<{
  onClick: () => void;
  title: string;
  active?: boolean;
  children: string;
}> = (props) => (
  <button
    class="px-1.5 py-0.5 text-[10px] rounded transition-colors"
    classList={{
      "bg-primary text-primary-foreground": props.active,
      "text-muted-foreground hover:bg-accent hover:text-foreground": !props.active,
    }}
    onClick={props.onClick}
    title={props.title}
  >
    {props.children}
  </button>
);

const TimelineToolbar: Component = () => (
  <div class="flex items-center gap-2 px-2 py-1 border-b border-border shrink-0 text-[10px]">
    <span class="font-mono text-foreground tabular-nums">
      {framesToTimecode(playheadFrame(), sequenceFrameRate())}
    </span>
    <span class="text-muted-foreground/60">
      / {framesToTimecode(contentEndFrame(doc()), sequenceFrameRate())}
    </span>

    <div class="w-px h-3 bg-border mx-1" />

    <Button onClick={() => addTrack("video")} title="Add a video track">
      + Video
    </Button>
    <Button onClick={() => addTrack("audio")} title="Add an audio track">
      + Audio
    </Button>

    <div class="w-px h-3 bg-border mx-1" />

    <Button
      onClick={toggleSnap}
      title="Snap clip edges to other clips and markers (S)"
      active={timelineState.snapEnabled}
    >
      Snap
    </Button>

    <div class="flex-1" />

    <Button onClick={zoomToFit} title="Fit the whole edit in the panel (Shift+Z)">
      Fit
    </Button>
    <Button onClick={zoomToFrameLevel} title="Zoom to individual frames">
      Frame
    </Button>
    <Button onClick={zoomOut} title="Zoom out (⌘−)">
      −
    </Button>
    {/*
      Shown as pixels per second rather than a percentage: a percentage of what
      was never defined, and the old readout was decoration anyway since zoom
      only affected ruler tick density.
    */}
    <span class="text-muted-foreground tabular-nums w-14 text-center">
      {pxPerSecond() >= 10
        ? `${Math.round(pxPerSecond())} px/s`
        : `${pxPerSecond().toFixed(1)} px/s`}
    </span>
    <Button onClick={zoomIn} title="Zoom in (⌘+)">
      +
    </Button>
  </div>
);

export default TimelineToolbar;
