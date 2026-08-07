import { Component, onMount, onCleanup, createSignal } from "solid-js";
import { doc, playheadFrame, sequenceFrameRate } from "@/stores/project-store";
import { contentEndFrame } from "@/model/doc";
import { framesToTimecode } from "@/lib/timecode";
import {
  createCompositor,
  disposeCompositor,
  renderBlackFrame,
  resizeCompositor,
  type Compositor,
} from "@/renderer/compositor";
import { startPreview, invalidatePreview } from "@/playback/scheduler";
import {
  isPlaying,
  pause,
  play,
  seekToFrame,
  shuttle,
  togglePlayback,
} from "@/playback/transport";

/**
 * How much smaller than the project the preview renders.
 *
 * Half resolution is a reasonable default; the quality ladder that adapts this
 * to measured frame time lands with the render graph.
 */
const PREVIEW_SCALE = 0.5;

const PreviewPanel: Component = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let compositor: Compositor | null = null;
  let scheduler: { stop: () => void } | null = null;
  const [glReady, setGlReady] = createSignal(false);

  onMount(() => {
    if (!canvasRef) return;

    const sequence = doc().sequence;
    canvasRef.width = Math.round(sequence.width * PREVIEW_SCALE);
    canvasRef.height = Math.round(sequence.height * PREVIEW_SCALE);

    compositor = createCompositor(canvasRef);
    if (!compositor) {
      console.warn("WebGL2 compositor failed to initialize");
      return;
    }

    setGlReady(true);
    renderBlackFrame(compositor);
    scheduler = startPreview(compositor);

    // The canvas is fixed at a fraction of the project resolution, but the
    // element it sits in is not — a resize needs a redraw, which the render
    // loop cannot observe on its own. `resizeCompositor` existed before and
    // was never called from anywhere.
    if (containerRef) {
      const observer = new ResizeObserver(() => {
        if (!compositor) return;
        const next = doc().sequence;
        const width = Math.round(next.width * PREVIEW_SCALE);
        const height = Math.round(next.height * PREVIEW_SCALE);
        if (compositor.width !== width || compositor.height !== height) {
          canvasRef.width = width;
          canvasRef.height = height;
          resizeCompositor(compositor, width, height);
        }
        invalidatePreview(compositor);
      });
      observer.observe(containerRef);
      onCleanup(() => observer.disconnect());
    }
  });

  onCleanup(() => {
    scheduler?.stop();
    if (compositor) disposeCompositor(compositor);
  });

  const endFrame = () => contentEndFrame(doc());

  const Transport: Component<{
    onClick: () => void;
    title: string;
    children: string;
  }> = (props) => (
    <button
      class="p-1.5 text-sm rounded hover:bg-accent text-muted-foreground hover:text-foreground"
      onClick={props.onClick}
      title={props.title}
    >
      {props.children}
    </button>
  );

  return (
    <div class="h-full flex flex-col bg-black">
      <div
        ref={containerRef}
        class="flex-1 flex items-center justify-center p-2 min-h-0"
      >
        <div class="relative w-full h-full flex items-center justify-center">
          <canvas
            ref={canvasRef}
            class="max-w-full max-h-full object-contain border border-border/30 rounded"
          />
          {!glReady() && (
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span class="text-muted-foreground/30 text-lg font-semibold">
                {doc().sequence.width} × {doc().sequence.height}
              </span>
            </div>
          )}
        </div>
      </div>

      <div class="flex items-center justify-center gap-2 py-2 px-3 border-t border-border bg-card">
        <Transport onClick={() => seekToFrame(0)} title="Go to start (Home)">
          ⏮
        </Transport>
        <Transport onClick={() => shuttle(-1)} title="Shuttle back (J)">
          ⏪
        </Transport>
        <button
          class={`p-2 text-base rounded-full ${
            isPlaying()
              ? "bg-destructive text-destructive-foreground"
              : "bg-primary text-primary-foreground"
          } hover:opacity-90`}
          onClick={togglePlayback}
          title="Play/Pause (Space)"
        >
          {isPlaying() ? "⏸" : "▶"}
        </button>
        <Transport onClick={() => (isPlaying() ? pause() : play())} title="Stop (K)">
          ⏹
        </Transport>
        <Transport onClick={() => shuttle(1)} title="Shuttle forward (L)">
          ⏩
        </Transport>
        <Transport onClick={() => seekToFrame(endFrame())} title="Go to end (End)">
          ⏭
        </Transport>

        <div class="mx-3 font-mono text-xs text-muted-foreground tabular-nums">
          {framesToTimecode(playheadFrame(), sequenceFrameRate())}
        </div>

        <div class="flex-1" />
        <button
          class="px-2 py-1 text-[10px] rounded bg-secondary text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (!canvasRef) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void canvasRef.requestFullscreen().catch(() => undefined);
          }}
          title="Toggle fullscreen"
        >
          ⛶ Fullscreen
        </button>
      </div>
    </div>
  );
};

export default PreviewPanel;
