import { Component } from "solid-js";
import type { Track } from "@/model/doc";
import { toggleTrackMute, toggleTrackLock } from "@/stores/project-store";
import {
  MIN_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
  setTrackHeight,
} from "@/stores/timeline-view-store";

export const TRACK_HEADER_WIDTH_PX = 128;

/**
 * A track's name and controls.
 *
 * Sticky to the left edge *inside* the scrolling strip rather than a sibling
 * column outside it. As a sibling the two had to be kept in vertical sync by
 * hand; sticky makes desync structurally impossible.
 */
const TrackHeader: Component<{ track: Track; heightPx: number }> = (props) => {
  const beginResize = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = props.heightPx;

    const onMove = (moveEvent: PointerEvent) => {
      setTrackHeight(props.track.id, startHeight + (moveEvent.clientY - startY));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      class="sticky left-0 z-20 shrink-0 flex items-center gap-1 px-2 border-b border-r border-border bg-panel-header"
      style={{ width: `${TRACK_HEADER_WIDTH_PX}px`, height: `${props.heightPx}px` }}
    >
      <span class="text-[10px] shrink-0 text-muted-foreground">
        {props.track.kind === "audio" ? "🎵" : "🎬"}
      </span>
      <span class="flex-1 text-[11px] truncate text-foreground">
        {props.track.name}
      </span>

      <button
        class="w-4 h-4 text-[9px] rounded shrink-0"
        classList={{
          "bg-destructive/70 text-white": props.track.muted,
          "text-muted-foreground hover:text-foreground": !props.track.muted,
        }}
        onClick={() => toggleTrackMute(props.track.id)}
        title={props.track.muted ? "Unmute" : "Mute"}
      >
        {props.track.muted ? "🔇" : "🔊"}
      </button>
      <button
        class="w-4 h-4 text-[9px] rounded shrink-0"
        classList={{
          "bg-amber-500/70 text-white": props.track.locked,
          "text-muted-foreground hover:text-foreground": !props.track.locked,
        }}
        onClick={() => toggleTrackLock(props.track.id)}
        title={props.track.locked ? "Unlock" : "Lock"}
      >
        {props.track.locked ? "🔒" : "🔓"}
      </button>

      {/* Drag the bottom edge to change lane height. */}
      <div
        class="absolute inset-x-0 bottom-0 h-1 cursor-ns-resize hover:bg-primary/50"
        onPointerDown={beginResize}
        title={`Drag to resize (${MIN_TRACK_HEIGHT}–${MAX_TRACK_HEIGHT}px)`}
      />
    </div>
  );
};

export default TrackHeader;
