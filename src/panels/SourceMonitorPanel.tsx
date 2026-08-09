import { Component, Show, createEffect, createMemo, onCleanup } from "solid-js";
import {
  sourceAsset,
  sourceAssetId,
  sourceFrame,
  setSourceFrame,
  inFrame,
  outFrame,
  effectiveOut,
  markedLength,
  markIn,
  markOut,
  clearMarks,
  sourceLengthFrames,
} from "@/stores/source-store";
import { doc, sequenceFrameRate } from "@/stores/project-store";
import { framesToTimecode } from "@/lib/timecode";
import { mediaEngine } from "@/media/engine";
import { createClip } from "@/model/doc";
import { insertFromSource } from "@/commands/source-edits";

/**
 * The source monitor.
 *
 * Where you decide what part of a shot to use before it reaches the timeline.
 * Draws straight to a 2D canvas rather than through the render graph: a source
 * has no transform, no effects and no layers underneath it, so there is
 * nothing for the compositor to do that `drawImage` does not.
 */

const SourceMonitorPanel: Component = () => {
  let canvas: HTMLCanvasElement | undefined;

  const asset = createMemo(() => sourceAsset());
  const rate = () => sequenceFrameRate();
  const length = createMemo(() => sourceLengthFrames());

  /**
   * A stand-in clip for the decoder to key on.
   *
   * The media engine decodes per *clip instance*, which is what stops two
   * clips of one file fighting over a position. The source monitor is another
   * such instance, and a stable id gives it a stable decoder rather than a new
   * one per frame.
   */
  const probe = createMemo(() => {
    const id = sourceAssetId();
    if (!id) return null;
    const clip = createClip({ type: "asset", assetId: id }, 0, Math.max(1, length()));
    clip.id = `source-monitor:${id}`;
    return clip;
  });

  const draw = () => {
    const element = canvas;
    const clip = probe();
    if (!element || !clip) return;

    const context = element.getContext("2d");
    if (!context) return;

    const frame = mediaEngine.tryGet(doc(), clip, sourceFrame());
    if (!frame) {
      // Nothing decoded yet. Leaving the previous frame up reads better than
      // flashing black between positions.
      return;
    }

    try {
      const { displayWidth, displayHeight } = frame.sample;
      if (element.width !== displayWidth || element.height !== displayHeight) {
        element.width = displayWidth;
        element.height = displayHeight;
      }
      context.drawImage(frame.sample.toCanvasImageSource(), 0, 0);
    } finally {
      frame.release();
    }
  };

  createEffect(() => {
    const clip = probe();
    const frame = sourceFrame();
    if (!clip) return;

    // Decode on demand, then draw. `tryGet` never waits, so the first attempt
    // usually misses and the await is what fills the cache for the redraw.
    void mediaEngine.getExact(doc(), clip, frame).then((borrowed) => {
      borrowed?.release();
      draw();
    });
    draw();
  });

  onCleanup(() => {
    const clip = probe();
    // Let the pool reclaim the decoder rather than holding one open for a
    // panel that is no longer on screen.
    if (clip) mediaEngine.retain([]);
  });

  const scrubTo = (event: PointerEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setSourceFrame(fraction * Math.max(0, length() - 1));
  };

  const percent = (frame: number) =>
    length() > 1 ? (frame / (length() - 1)) * 100 : 0;

  return (
    <div class="h-full flex flex-col text-sm">
      <Show
        when={asset()}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2 p-4 text-center">
            <span class="text-2xl">🎞️</span>
            <span>No source loaded</span>
            <span class="text-[10px]">
              Double-click something in the Media Pool to open it here.
            </span>
          </div>
        }
      >
        {(loaded) => (
          <>
            <div class="flex-1 min-h-0 bg-black flex items-center justify-center">
              <canvas ref={canvas} class="max-w-full max-h-full object-contain" />
            </div>

            <div class="px-2 pt-1.5 pb-1 space-y-1.5 border-t border-border">
              <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span class="truncate flex-1" title={loaded().name}>
                  {loaded().name}
                </span>
                <span class="font-mono tabular-nums">
                  {framesToTimecode(sourceFrame(), rate())}
                </span>
              </div>

              {/* Scrubber, with the marked range shaded. */}
              <div
                class="relative h-4 bg-secondary rounded cursor-pointer"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  scrubTo(e, e.currentTarget);
                }}
                onPointerMove={(e) => {
                  if (e.buttons !== 1) return;
                  scrubTo(e, e.currentTarget);
                }}
              >
                <div
                  class="absolute inset-y-0 bg-primary/25"
                  style={{
                    left: `${percent(inFrame())}%`,
                    width: `${Math.max(0, percent(effectiveOut()) - percent(inFrame()))}%`,
                  }}
                />
                <div
                  class="absolute inset-y-0 w-0.5 bg-primary"
                  style={{ left: `${percent(inFrame())}%` }}
                  title={`In ${framesToTimecode(inFrame(), rate())}`}
                />
                <Show when={outFrame() !== null}>
                  <div
                    class="absolute inset-y-0 w-0.5 bg-primary"
                    style={{ left: `${percent(effectiveOut())}%` }}
                    title={`Out ${framesToTimecode(effectiveOut(), rate())}`}
                  />
                </Show>
                <div
                  class="absolute inset-y-0 w-px bg-red-500"
                  style={{ left: `${percent(sourceFrame())}%` }}
                />
              </div>

              <div class="flex items-center gap-1">
                <button
                  class="px-2 py-0.5 text-[10px] rounded bg-secondary hover:bg-accent border border-border"
                  onClick={markIn}
                  title="Mark in (I)"
                >
                  ⟦ In
                </button>
                <button
                  class="px-2 py-0.5 text-[10px] rounded bg-secondary hover:bg-accent border border-border"
                  onClick={markOut}
                  title="Mark out (O)"
                >
                  Out ⟧
                </button>
                <button
                  class="px-2 py-0.5 text-[10px] rounded text-muted-foreground hover:text-foreground"
                  onClick={clearMarks}
                  title="Clear the marks and use the whole clip"
                >
                  Clear
                </button>

                <span class="ml-auto text-[10px] font-mono text-muted-foreground tabular-nums">
                  {framesToTimecode(markedLength(), rate())}
                </span>
              </div>

              <div class="flex items-center gap-1">
                <button
                  class="flex-1 px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground disabled:opacity-40"
                  disabled={markedLength() < 1}
                  onClick={() => insertFromSource("insert")}
                  title="Insert at the playhead, pushing everything after it (,)"
                >
                  Insert
                </button>
                <button
                  class="flex-1 px-2 py-1 text-[10px] rounded bg-primary/20 hover:bg-primary/30 border border-primary text-primary disabled:opacity-40"
                  disabled={markedLength() < 1}
                  onClick={() => insertFromSource("overwrite")}
                  title="Overwrite at the playhead (.)"
                >
                  Overwrite
                </button>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default SourceMonitorPanel;
