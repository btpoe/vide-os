import { Component, For, Show, createMemo } from "solid-js";
import { frameToContentX, framesToWidth } from "@/lib/timeline-geometry";
import { timelineView } from "@/stores/timeline-view-store";
import { doc, setPlayheadFrame } from "@/stores/project-store";
import { beginCueDrag } from "./interactions";

export const SUBTITLE_LANE_HEIGHT_PX = 18;

/**
 * Where the captions fall.
 *
 * Writing them happens in the Captions panel; this is for seeing a caption
 * overrun a shot, or a gap where nobody is speaking. Drag the body to move a
 * cue, the edges to change how long it is on screen.
 */
const SubtitleLane: Component = () => {
  const cues = createMemo(() => doc().subtitles);
  const cueIds = createMemo(() => cues().map((c) => c.id));
  const cueById = (id: string) => cues().find((c) => c.id === id);

  return (
    <div
      class="relative border-b border-border/60 bg-secondary/20"
      style={{ height: `${SUBTITLE_LANE_HEIGHT_PX}px` }}
      data-subtitle-lane
    >
      <For each={cueIds()}>
        {(cueId) => (
          <Show when={cueById(cueId)}>
            {(cue) => {
              const x = () => frameToContentX(timelineView(), cue().startFrame);
              const width = () =>
                Math.max(
                  2,
                  framesToWidth(timelineView(), cue().endFrame - cue().startFrame),
                );

              return (
                <div
                  data-cue-id={cueId}
                  class="absolute top-[2px] bottom-[2px] rounded-[2px] bg-amber-500/30 border border-amber-500/60 overflow-hidden cursor-grab"
                  style={{ left: `${x()}px`, width: `${width()}px` }}
                  title={cue().text || "Empty caption"}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    setPlayheadFrame(cue().startFrame);
                    beginCueDrag(e, cueId, "move");
                  }}
                >
                  <span class="px-1 text-[9px] leading-[14px] text-foreground/90 whitespace-nowrap pointer-events-none">
                    {cue().text.replace(/\n/g, " ")}
                  </span>

                  {/* Edge handles, as on a clip. */}
                  <div
                    class="absolute inset-y-0 left-0 w-[5px] cursor-ew-resize hover:bg-white/30"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      beginCueDrag(e, cueId, "start");
                    }}
                  />
                  <div
                    class="absolute inset-y-0 right-0 w-[5px] cursor-ew-resize hover:bg-white/30"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      beginCueDrag(e, cueId, "end");
                    }}
                  />
                </div>
              );
            }}
          </Show>
        )}
      </For>
    </div>
  );
};

export default SubtitleLane;
