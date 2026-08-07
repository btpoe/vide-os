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
import { beginClipDrag, beginTrim, razorAt } from "./interactions";
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

    selectClip(
      { trackId: props.track.id, clipId: props.clip.id },
      event.shiftKey || event.metaKey || event.ctrlKey,
    );
    beginClipDrag(event, props.track.id, props.clip.id);
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

      {/* Trim handles. Wider than they look, so they are catchable. */}
      <Show when={uiState.selectedTool === "select" && width() > TRIM_HANDLE_PX * 3}>
        <div
          class="absolute inset-y-0 left-0 cursor-ew-resize hover:bg-white/25"
          style={{ width: `${TRIM_HANDLE_PX}px` }}
          onPointerDown={(e) => beginTrim(e, props.track.id, props.clip.id, "start")}
        />
        <div
          class="absolute inset-y-0 right-0 cursor-ew-resize hover:bg-white/25"
          style={{ width: `${TRIM_HANDLE_PX}px` }}
          onPointerDown={(e) => beginTrim(e, props.track.id, props.clip.id, "end")}
        />
      </Show>
    </div>
  );
};

export default ClipView;
