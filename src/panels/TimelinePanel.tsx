import {
  Component,
  For,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  doc,
  addClipToTrack,
  addTextClip,
  setPlayheadFrame,
  sequenceFrameRate,
} from "@/stores/project-store";
import { clearSelection, selectClip } from "@/stores/timeline-store";
import { uiState } from "@/stores/ui-store";
import { takeDragFileHandle } from "@/lib/drag-payload";
import { contentEndFrame } from "@/model/doc";
import { contentWidthPx } from "@/lib/timeline-geometry";
import {
  scrollLeftPx,
  setScrollLeft,
  setViewportWidth,
  timelineView,
  trackHeight,
  zoomAtX,
  ZOOM_STEP,
} from "@/stores/timeline-view-store";
import { framesToSeconds } from "@/lib/timecode";
import TimelineToolbar from "./timeline/TimelineToolbar";
import TimelineRuler, { RULER_HEIGHT_PX } from "./timeline/TimelineRuler";
import TrackHeader, { TRACK_HEADER_WIDTH_PX } from "./timeline/TrackHeader";
import TrackLane from "./timeline/TrackLane";
import TimelineOverlay from "./timeline/TimelineOverlay";
import MarkerLane, { MARKER_LANE_HEIGHT_PX } from "./timeline/MarkerLane";
import SubtitleLane, { SUBTITLE_LANE_HEIGHT_PX } from "./timeline/SubtitleLane";
import { frameFromEvent } from "./timeline/interactions";

/**
 * The timeline.
 *
 * Structurally this is one horizontally scrolling strip containing the ruler,
 * every track lane, and a single overlay for the playhead. Track headers are
 * sticky to its left edge rather than a separate column, so the ruler, the
 * lanes and the headers cannot drift out of alignment.
 *
 * Positions come from `lib/timeline-geometry` — pixels-per-frame and a scroll
 * offset — rather than a percentage of total project duration. That is what
 * makes zoom possible at all.
 */
const TimelinePanel: Component = () => {
  const [dropTrackId, setDropTrackId] = createSignal<string | null>(null);
  let scrollerRef: HTMLDivElement | undefined;

  const tracks = () => doc().tracks;
  const endFrame = createMemo(() => contentEndFrame(doc()));

  const laneHeight = (trackId: string, kind: "video" | "audio") =>
    trackHeight(trackId, kind === "video" ? 56 : 44);

  const stripWidth = createMemo(() => contentWidthPx(timelineView(), endFrame()));

  const bodyHeight = createMemo(() =>
    tracks().reduce((total, t) => total + laneHeight(t.id, t.kind) + 1, 0),
  );

  // ── Viewport tracking ───────────────────────────────────────────────

  onMount(() => {
    if (!scrollerRef) return;

    // The geometry needs the width of the visible strip, excluding the sticky
    // headers, to decide what is on screen and how far it can scroll.
    const observer = new ResizeObserver(([entry]) => {
      setViewportWidth(entry.contentRect.width - TRACK_HEADER_WIDTH_PX);
    });
    observer.observe(scrollerRef);
    onCleanup(() => observer.disconnect());

    setViewportWidth(scrollerRef.clientWidth - TRACK_HEADER_WIDTH_PX);
  });

  /**
   * Native scrolling drives the store rather than the other way round, so the
   * browser keeps ownership of momentum and scrollbars. Writing back on every
   * scroll event is cheap because the store dedupes identical values.
   */
  const handleScroll = (event: Event) => {
    setScrollLeft((event.currentTarget as HTMLDivElement).scrollLeft);
  };

  // Keep the DOM in step when zoom or a command moves the offset. Guarded by
  // a tolerance so this does not fight the scroll handler feeding it back.
  createEffect(() => {
    const target = scrollLeftPx();
    if (scrollerRef && Math.abs(scrollerRef.scrollLeft - target) > 0.5) {
      scrollerRef.scrollLeft = target;
    }
  });

  // ── Wheel ───────────────────────────────────────────────────────────

  const handleWheel = (event: WheelEvent) => {
    // Ctrl/Cmd+wheel and trackpad pinch both arrive as a ctrlKey wheel event.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      // zoomAt wants an offset into the visible strip: the pointer's distance
      // from the scroller's left edge, less the sticky header gutter.
      const anchorX = event.clientX - rect.left - TRACK_HEADER_WIDTH_PX;
      // deltaY is negative when zooming in.
      zoomAtX(anchorX, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      return;
    }
    // Shift+wheel pans horizontally, matching every other timeline.
    if (event.shiftKey && scrollerRef) {
      event.preventDefault();
      setScrollLeft(scrollLeftPx() + event.deltaY);
    }
  };

  // ── Empty-space clicks ──────────────────────────────────────────────

  const handleLanePointerDown = (event: PointerEvent, trackId: string) => {
    if (event.button !== 0) return;

    if (uiState.selectedTool === "text") {
      const clip = addTextClip(
        trackId,
        framesToSeconds(frameFromEvent(event), sequenceFrameRate()),
      );
      if (clip) selectClip({ trackId, clipId: clip.id });
      return;
    }

    // Clicking empty track space deselects and moves the playhead there,
    // which is what every NLE does.
    clearSelection();
    setPlayheadFrame(frameFromEvent(event));
  };

  // ── Drag and drop from the media pool ───────────────────────────────

  const handleDrop = (event: DragEvent, trackId: string) => {
    event.preventDefault();
    setDropTrackId(null);

    const frame = frameFromEvent(event);
    const startTime = framesToSeconds(frame, sequenceFrameRate());

    const mediaData = event.dataTransfer?.getData("application/x-vide-os-media");
    if (mediaData) {
      try {
        const data = JSON.parse(mediaData) as {
          id: string;
          name: string;
          duration?: number;
        };
        addClipToTrack(trackId, data.id, data.name, data.duration || 10, startTime);
      } catch {
        // Malformed drag payload — ignore the drop.
      }
      return;
    }

    const fileData = event.dataTransfer?.getData("application/x-vide-os-file");
    if (!fileData) return;

    const handle = takeDragFileHandle();
    if (!handle) return;

    void (async () => {
      const { importFileHandle } = await import("@/stores/media-store");
      const entry = await importFileHandle(handle);
      if (!entry) return;
      addClipToTrack(trackId, entry.id, entry.name, entry.duration || 10, startTime);
    })();
  };

  const handleDragOver = (event: DragEvent, trackId: string) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDropTrackId(trackId);
  };

  return (
    <div class="h-full flex flex-col text-sm select-none">
      <TimelineToolbar />

      <div
        ref={scrollerRef}
        class="flex-1 overflow-x-auto overflow-y-auto"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        {/*
          One strip, `stripWidth` wide, holding everything. Everything inside
          positions itself against the same origin, so nothing can desync.
        */}
        <div
          data-timeline-strip
          class="relative"
          style={{ width: `${stripWidth() + TRACK_HEADER_WIDTH_PX}px` }}
        >
          <div class="flex">
            {/* Spacer keeping the ruler clear of the sticky headers. */}
            <div
              class="sticky left-0 z-20 shrink-0 border-b border-r border-border bg-panel-header"
              style={{
                width: `${TRACK_HEADER_WIDTH_PX}px`,
                height: `${RULER_HEIGHT_PX}px`,
              }}
            />
            <div class="relative flex-1" style={{ width: `${stripWidth()}px` }}>
              <TimelineRuler />
            </div>
          </div>

          {/* Markers sit between the ruler and the tracks: they belong to the
              sequence, not to any one track. */}
          <div class="flex">
            <div
              class="sticky left-0 z-20 shrink-0 border-b border-r border-border bg-panel-header flex items-center px-1.5 text-[9px] text-muted-foreground"
              style={{
                width: `${TRACK_HEADER_WIDTH_PX}px`,
                height: `${MARKER_LANE_HEIGHT_PX}px`,
              }}
            >
              Markers
            </div>
            <div class="relative" style={{ width: `${stripWidth()}px` }}>
              <MarkerLane />
            </div>
          </div>

          {/* Captions belong to the sequence too, so they sit beside the
              markers rather than on a track. Only shown when there are any. */}
          <Show when={doc().subtitles.length > 0}>
            <div class="flex">
              <div
                class="sticky left-0 z-20 shrink-0 border-b border-r border-border bg-panel-header flex items-center px-1.5 text-[9px] text-muted-foreground"
                style={{
                  width: `${TRACK_HEADER_WIDTH_PX}px`,
                  height: `${SUBTITLE_LANE_HEIGHT_PX}px`,
                }}
              >
                Captions
              </div>
              <div class="relative" style={{ width: `${stripWidth()}px` }}>
                <SubtitleLane />
              </div>
            </div>
          </Show>

          <For each={tracks()}>
            {(track) => (
              <div class="flex">
                <TrackHeader
                  track={track}
                  heightPx={laneHeight(track.id, track.kind)}
                />
                <div
                  data-track-content
                  class="relative"
                  style={{ width: `${stripWidth()}px` }}
                  onPointerDown={(e) => handleLanePointerDown(e, track.id)}
                  onDrop={(e) => handleDrop(e, track.id)}
                  onDragOver={(e) => handleDragOver(e, track.id)}
                  onDragLeave={() => setDropTrackId(null)}
                >
                  <TrackLane
                    track={track}
                    heightPx={laneHeight(track.id, track.kind)}
                    isDropTarget={dropTrackId() === track.id}
                  />
                </div>
              </div>
            )}
          </For>

          {/* Playhead and snap guide, offset past the sticky headers. */}
          <div
            class="absolute top-0 pointer-events-none"
            style={{ left: `${TRACK_HEADER_WIDTH_PX}px`, width: `${stripWidth()}px` }}
          >
            <TimelineOverlay
              heightPx={
                RULER_HEIGHT_PX +
                MARKER_LANE_HEIGHT_PX +
                (doc().subtitles.length > 0 ? SUBTITLE_LANE_HEIGHT_PX : 0) +
                bodyHeight()
              }
            />
          </div>
        </div>
      </div>

      <div class="px-2 py-0.5 border-t border-border text-[9px] text-muted-foreground shrink-0">
        ⌘-scroll or pinch to zoom · shift-scroll to pan · drag media onto a track
      </div>
    </div>
  );
};

export default TimelinePanel;
