import { Component, Show, createMemo } from "solid-js";
import type { Clip, Track } from "@/model/doc";
import { clipEndFrame } from "@/model/doc";
import { framesToWidth, frameToContentX } from "@/lib/timeline-geometry";
import { timelineView } from "@/stores/timeline-view-store";
import { isClipSelected, selectClip } from "@/stores/timeline-store";
import { uiState } from "@/stores/ui-store";
import { previewVersion } from "@/lib/media-previews";
import { getCachedWaveform, waveformToSvgPath } from "@/lib/waveform";
import { getCachedThumbnail } from "@/lib/clip-thumbnails";
import {
  beginClipDrag,
  beginTrim,
  beginRippleTrim,
  beginRoll,
  beginSlip,
  beginSlide,
  razorAt,
} from "./interactions";
import { mediaState } from "@/stores/media-store";

/** Hit area for the trim handles at each end. */
const TRIM_HANDLE_PX = 8;

/**
 * Below these widths a decoration costs more than it conveys, so it is skipped.
 * This is what keeps a timeline full of one-frame clips cheap.
 */
const MIN_WIDTH_FOR_LABEL = 28;
const MIN_WIDTH_FOR_DECORATION = 48;

const ClipView: Component<{ track: Track; clip: Clip }> = (props) => {
  const selected = () => isClipSelected(props.track.id, props.clip.id);
  const x = () => frameToContentX(timelineView(), props.clip.startFrame);
  const width = () => framesToWidth(timelineView(), props.clip.durationFrames);

  const label = createMemo(() => {
    const source = props.clip.source;
    if (source.type === "text") {
      const text = source.style.text.trim();
      return text.length > 24 ? `${text.slice(0, 24)}…` : text || "Title";
    }
    if (source.type === "solid") return "Colour";
    return (
      mediaState.entries.find((e) => e.id === source.assetId)?.name ?? "Offline media"
    );
  });

  /** Assets the document knows are unusable get a visible marker. */
  const offline = createMemo(() => {
    const source = props.clip.source;
    if (source.type !== "asset") return false;
    return !mediaState.entries.some((e) => e.id === source.assetId);
  });

  const mediaId = () =>
    props.clip.source.type === "asset" ? props.clip.source.assetId : null;

  const waveformPath = createMemo(() => {
    previewVersion(); // re-read the cache when a decoration lands
    const id = mediaId();
    if (!id || width() < MIN_WIDTH_FOR_DECORATION) return null;
    const data = getCachedWaveform(id);
    if (!data) return null;
    return waveformToSvgPath(data, 1000, 40, 0, 1);
  });

  const thumbnail = createMemo(() => {
    previewVersion();
    const id = mediaId();
    if (!id || width() < MIN_WIDTH_FOR_DECORATION) return null;
    return getCachedThumbnail(id);
  });

  const edgeGrabbable = () =>
    uiState.selectedTool === "select" || uiState.selectedTool === "trim";

  const edgeHint = () =>
    uiState.selectedTool === "trim"
      ? "Roll the cut"
      : "Drag to trim · hold Alt to ripple";

  const palette = () =>
    props.clip.source.type === "text"
      ? "168,85,247"
      : props.track.kind === "audio"
        ? "34,197,94"
        : "59,130,246";

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    if (uiState.selectedTool === "razor") {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const frame =
        props.clip.startFrame +
        Math.round((event.clientX - rect.left) / timelineView().pxPerFrame);
      razorAt(props.track.id, props.clip.id, frame);
      return;
    }

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const ref = { trackId: props.track.id, clipId: props.clip.id };

    // Selecting an *already selected* clip is deferred to pointer-up: doing it
    // now would collapse a multi-clip selection to one clip, and then a drag
    // would move only that one. See `beginClipDrag`'s `onTap`.
    const deferSelection = selected() && !additive;
    if (!deferSelection) selectClip(ref, additive);

    // Slip and slide are grabs of the clip body, not of an edge: the whole
    // clip is the handle, and which edit happens is the tool's business.
    switch (uiState.selectedTool) {
      case "slip":
        beginSlip(event, props.track.id, props.clip.id);
        return;
      case "slide":
        beginSlide(event, props.track.id, props.clip.id);
        return;
      default:
        beginClipDrag(event, props.track.id, props.clip.id, () => {
          if (deferSelection) selectClip(ref, false);
        });
    }
  };

  /**
   * Which edit an edge handle performs.
   *
   * The Trim tool rolls the cut — the two clips either side move together —
   * while the Select tool trims one clip and leaves a gap. Holding Alt makes
   * either one ripple, closing the gap behind it. These are the four things
   * you can do to an edge, on one handle, rather than four handles.
   */
  const grabEdge = (event: PointerEvent, side: "start" | "end") => {
    const { id: trackId } = props.track;
    const clipId = props.clip.id;

    if (uiState.selectedTool === "trim") {
      // Rolling is defined from the clip on the left of the cut.
      if (side === "end") beginRoll(event, trackId, clipId);
      else beginRoll(event, trackId, previousClipId() ?? clipId);
      return;
    }
    if (event.altKey) beginRippleTrim(event, trackId, clipId, side);
    else beginTrim(event, trackId, clipId, side);
  };

  /** The clip before this one on the same track, if they are butted. */
  const previousClipId = (): string | null => {
    const index = props.track.clips.findIndex((c) => c.id === props.clip.id);
    const previous = props.track.clips[index - 1];
    if (!previous || clipEndFrame(previous) !== props.clip.startFrame) return null;
    return previous.id;
  };

  return (
    <div
      data-clip-id={props.clip.id}
      data-clip-start={props.clip.startFrame}
      data-clip-end={clipEndFrame(props.clip)}
      class="absolute top-[3px] bottom-[3px] rounded-[3px] overflow-hidden select-none"
      classList={{
        "cursor-grab": uiState.selectedTool === "select",
        "cursor-crosshair": uiState.selectedTool === "razor",
        "cursor-ew-resize":
          uiState.selectedTool === "slip" || uiState.selectedTool === "slide",
        "opacity-50": !props.clip.enabled,
      }}
      style={{
        left: `${x()}px`,
        width: `${Math.max(2, width())}px`,
        background: selected() ? `rgba(${palette()},0.55)` : `rgba(${palette()},0.3)`,
        border: selected()
          ? `1px solid rgb(${palette()})`
          : `1px solid rgba(${palette()},0.55)`,
      }}
      onPointerDown={handlePointerDown}
      title={label()}
    >
      <Show when={thumbnail()}>
        {(src) => (
          <img
            src={src()}
            alt=""
            draggable={false}
            class="absolute inset-y-0 left-0 h-full w-auto opacity-40 pointer-events-none object-cover"
          />
        )}
      </Show>

      <Show when={waveformPath()}>
        {(path) => (
          <svg
            class="absolute inset-x-0 bottom-0 h-1/2 w-full pointer-events-none"
            viewBox="0 0 1000 40"
            preserveAspectRatio="none"
          >
            <path d={path()} fill={`rgba(${palette()},0.75)`} />
          </svg>
        )}
      </Show>

      <Show when={width() >= MIN_WIDTH_FOR_LABEL}>
        <div class="relative px-1.5 pt-0.5 text-[10px] leading-tight text-foreground/90 truncate pointer-events-none">
          <Show when={offline()}>
            <span class="text-destructive mr-1" title="Media offline">
              ⚠
            </span>
          </Show>
          {label()}
        </div>
      </Show>

      {/* Edge handles. Wider than they look, so they are catchable. */}
      <Show when={edgeGrabbable() && width() > TRIM_HANDLE_PX * 3}>
        <div
          class="absolute inset-y-0 left-0 cursor-ew-resize hover:bg-white/25"
          style={{ width: `${TRIM_HANDLE_PX}px` }}
          title={edgeHint()}
          onPointerDown={(e) => grabEdge(e, "start")}
        />
        <div
          class="absolute inset-y-0 right-0 cursor-ew-resize hover:bg-white/25"
          style={{ width: `${TRIM_HANDLE_PX}px` }}
          title={edgeHint()}
          onPointerDown={(e) => grabEdge(e, "end")}
        />
      </Show>
    </div>
  );
};

export default ClipView;
