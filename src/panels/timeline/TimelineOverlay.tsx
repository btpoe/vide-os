import { Component, Show } from "solid-js";
import { frameToContentX } from "@/lib/timeline-geometry";
import { timelineView } from "@/stores/timeline-view-store";
import { playheadFrame } from "@/stores/project-store";
import { snapGuideFrame } from "./interactions";
import { TRACK_HEADER_WIDTH_PX } from "./TrackHeader";

/**
 * Playhead and snap guide, drawn once across the whole strip.
 *
 * Previously the playhead was a separate absolutely-positioned div inside
 * every track lane, so a four-track timeline drew four of them and each had to
 * be kept in step. One element in an overlay cannot disagree with itself.
 *
 * Sits above the lanes but below the sticky track headers, so the playhead
 * disappears behind the headers rather than drawing over them.
 */
const TimelineOverlay: Component<{ heightPx: number }> = (props) => {
  const playheadX = () => frameToContentX(timelineView(), playheadFrame());
  const guideX = () => {
    const frame = snapGuideFrame();
    return frame === null ? null : frameToContentX(timelineView(), frame);
  };

  return (
    <div
      class="absolute top-0 left-0 pointer-events-none z-10"
      style={{ height: `${props.heightPx}px`, width: "100%" }}
    >
      <Show when={guideX() !== null}>
        <div
          class="absolute top-0 bottom-0 w-px bg-amber-400"
          style={{ left: `${guideX()!}px` }}
        />
      </Show>

      {/* Hidden while scrolled behind the sticky headers. */}
      <Show when={playheadX() >= TRACK_HEADER_WIDTH_PX - TRACK_HEADER_WIDTH_PX}>
        <div class="absolute top-0 bottom-0" style={{ left: `${playheadX()}px` }}>
          <div class="w-px h-full bg-red-500" />
          <div class="absolute -left-[4px] top-0 w-[9px] h-[9px] bg-red-500 [clip-path:polygon(0_0,100%_0,50%_100%)]" />
        </div>
      </Show>
    </div>
  );
};

export default TimelineOverlay;
