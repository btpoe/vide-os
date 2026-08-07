import { Component, For, createMemo, createEffect } from "solid-js";
import type { Track } from "@/model/doc";
import { isVisible } from "@/lib/timeline-geometry";
import { timelineView } from "@/stores/timeline-view-store";
import { requestThumbnail, requestWaveform } from "@/lib/media-previews";
import ClipView from "./ClipView";

/**
 * One track's strip of clips.
 *
 * Only clips intersecting the viewport are rendered. At this tier culling beats
 * virtualisation: it costs one filter per track, and it does not break dragging
 * a clip across the boundary of a recycled row.
 */
const TrackLane: Component<{
  track: Track;
  heightPx: number;
  isDropTarget: boolean;
}> = (props) => {
  /** A margin of clips either side, so edges scrolling in are already drawn. */
  const visibleClips = createMemo(() => {
    const view = timelineView();
    return props.track.clips.filter((clip) =>
      isVisible(view, clip.startFrame, clip.durationFrames, 30),
    );
  });

  // Decorations are requested from an effect, never from the render body.
  // Doing it during render meant every reconcile re-fired the work.
  createEffect(() => {
    for (const clip of visibleClips()) {
      if (clip.source.type !== "asset") continue;
      if (props.track.kind === "audio") requestWaveform(clip.source.assetId);
      else requestThumbnail(clip.source.assetId);
    }
  });

  return (
    <div
      data-track-lane={props.track.id}
      class="relative border-b border-border/40"
      classList={{
        "bg-primary/10": props.isDropTarget,
        "bg-secondary/20": !props.isDropTarget && props.track.kind === "audio",
      }}
      style={{ height: `${props.heightPx}px` }}
    >
      <For each={visibleClips()}>
        {(clip) => <ClipView track={props.track} clip={clip} />}
      </For>
    </div>
  );
};

export default TrackLane;
