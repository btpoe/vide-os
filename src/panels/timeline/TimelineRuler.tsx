import { Component, For, createMemo } from "solid-js";
import { rulerTicks } from "@/lib/timeline-geometry";
import { timelineView } from "@/stores/timeline-view-store";
import { sequenceFrameRate } from "@/stores/project-store";
import {
  framesToTimecode,
  framesToSeconds,
  formatDurationSeconds,
} from "@/lib/timecode";
import { beginScrub } from "./interactions";

export const RULER_HEIGHT_PX = 24;

/**
 * The time ruler.
 *
 * Ticks come from the geometry, which generates only what is on screen at a
 * spacing that keeps labels readable — so the cost does not grow with project
 * length. Labels switch to full timecode once individual frames are
 * distinguishable, and stay as coarse durations when zoomed out.
 */
const TimelineRuler: Component = () => {
  const ticks = createMemo(() => rulerTicks(timelineView(), sequenceFrameRate()));

  /** Frames are only worth showing when a frame is at least a pixel or two. */
  const showFrames = () => timelineView().pxPerFrame >= 3;

  const labelFor = (frame: number): string => {
    const rate = sequenceFrameRate();
    return showFrames()
      ? framesToTimecode(frame, rate)
      : formatDurationSeconds(framesToSeconds(frame, rate));
  };

  return (
    <div
      data-ruler
      class="relative shrink-0 border-b border-border bg-panel-header cursor-text select-none"
      style={{ height: `${RULER_HEIGHT_PX}px` }}
      onPointerDown={beginScrub}
    >
      <For each={ticks()}>
        {(tick) => (
          <div
            class="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${tick.x}px` }}
          >
            <div
              class="w-px bg-border"
              style={{ height: tick.major ? "100%" : "40%" }}
            />
            <span class="absolute left-1 top-0 text-[9px] leading-[14px] text-muted-foreground whitespace-nowrap font-mono">
              {labelFor(tick.frame)}
            </span>
          </div>
        )}
      </For>
    </div>
  );
};

export default TimelineRuler;
