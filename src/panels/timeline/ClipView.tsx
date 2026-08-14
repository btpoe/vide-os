import { Component, For, Show, createMemo } from "solid-js";
import type { Clip, Track } from "@/model/doc";
import { clipEndFrame } from "@/model/doc";
import { framesToWidth, frameToContentX } from "@/lib/timeline-geometry";
import { framesToSeconds } from "@/lib/timecode";
import { timelineView } from "@/stores/timeline-view-store";
import { sequenceFrameRate } from "@/stores/project-store";
import { isClipSelected, selectClip } from "@/stores/timeline-store";
import { uiState } from "@/stores/ui-store";
import { previewVersion } from "@/lib/media-previews";
import { peaksForRange, peaksToSvgPath } from "@/lib/waveform";
import { getCachedWaveform } from "@/lib/waveform-cache";
import { getCachedFilmstrip, tileIndexAt } from "@/lib/clip-thumbnails";
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

/** Height the waveform path is drawn against, stretched by the SVG viewBox. */
const WAVEFORM_VIEW_HEIGHT = 40;

/**
 * Caps on decoration detail, so a clip zoomed to twenty thousand pixels wide
 * does not cost twenty thousand peak columns or two hundred DOM nodes. Past
 * these the columns and tiles stretch instead of multiplying — which is the
 * right answer anyway, since at that zoom consecutive frames are near-identical.
 */
const MAX_WAVEFORM_COLUMNS = 2000;
const MAX_FILMSTRIP_TILES = 60;

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

  /**
   * The span of the *source* this clip shows.
   *
   * Both decorations are indexed by source time rather than by position on the
   * timeline, which is what makes them follow a trim, a slip and a speed change
   * without anything being regenerated. The old waveform was stretched across
   * whatever width the clip happened to have, so trimming a clip stretched its
   * waveform instead of revealing a different part of it.
   */
  const sourceSpan = createMemo(() => {
    const rate = sequenceFrameRate();
    const start = framesToSeconds(props.clip.inPointFrames, rate);
    return {
      start,
      end: start + framesToSeconds(props.clip.durationFrames * props.clip.speed, rate),
    };
  });

  /**
   * Which decoration this clip gets, decided by the track and not by what
   * happens to be cached.
   *
   * `TrackLane` requests peaks for audio tracks and a filmstrip for video ones,
   * so reading whichever cache has something would make a video clip sprout a
   * waveform if — and only if — a copy of the same asset were also sitting on an
   * audio track. Predictable beats incidental.
   */
  const wantsWaveform = () => props.track.kind === "audio";

  const waveform = createMemo(() => {
    previewVersion(); // re-read the cache when a decoration lands
    const id = mediaId();
    const px = width();
    if (!id || !wantsWaveform() || px < MIN_WIDTH_FOR_DECORATION) return null;
    const pyramid = getCachedWaveform(id);
    if (!pyramid) return null;

    // One column per pixel: the pyramid makes that cost the same on an hour-long
    // file as on a two-second one.
    const columns = Math.max(2, Math.min(MAX_WAVEFORM_COLUMNS, Math.round(px)));
    const { start, end } = sourceSpan();
    const peaks = peaksForRange(pyramid, start, end, columns);
    return {
      columns,
      path: peaksToSvgPath(peaks, columns, WAVEFORM_VIEW_HEIGHT),
    };
  });

  const filmstrip = createMemo(() => {
    previewVersion();
    const id = mediaId();
    const px = width();
    if (!id || wantsWaveform() || px < MIN_WIDTH_FOR_DECORATION) return null;
    const strip = getCachedFilmstrip(id);
    if (!strip) return null;

    const tileWidth = Math.max(strip.tileWidth, px / MAX_FILMSTRIP_TILES);
    const count = Math.max(1, Math.min(MAX_FILMSTRIP_TILES, Math.ceil(px / tileWidth)));
    const { start, end } = sourceSpan();

    const tiles: { x: number; offset: number }[] = [];
    for (let i = 0; i < count; i++) {
      const sourceSec = start + ((i + 0.5) / count) * (end - start);
      tiles.push({
        x: i * tileWidth,
        offset: tileIndexAt(strip, sourceSec) * tileWidth,
      });
    }

    return { url: strip.url, tileWidth, sheetWidth: strip.tiles * tileWidth, tiles };
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
      <Show when={filmstrip()}>
        {(strip) => (
          <div class="absolute inset-0 opacity-40 pointer-events-none" data-filmstrip>
            <For each={strip().tiles}>
              {(tile) => (
                <div
                  class="absolute inset-y-0 bg-no-repeat"
                  style={{
                    left: `${tile.x}px`,
                    width: `${strip().tileWidth}px`,
                    "background-image": `url(${strip().url})`,
                    // The sheet is one row, so only the horizontal offset picks
                    // the tile; the vertical scale fills the lane whatever
                    // height it has been dragged to.
                    "background-size": `${strip().sheetWidth}px 100%`,
                    "background-position": `-${tile.offset}px 0`,
                  }}
                />
              )}
            </For>
          </div>
        )}
      </Show>

      <Show when={waveform()}>
        {(wave) => (
          <svg
            class="absolute inset-x-0 bottom-0 h-1/2 w-full pointer-events-none"
            viewBox={`0 0 ${wave().columns} ${WAVEFORM_VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            data-waveform
          >
            <path d={wave().path} fill={`rgba(${palette()},0.75)`} />
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
