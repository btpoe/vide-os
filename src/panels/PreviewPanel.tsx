import {
  Component,
  onMount,
  onCleanup,
  createEffect,
  createSignal,
  Show,
} from "solid-js";
import { doc, playheadFrame, sequenceFrameRate } from "@/stores/project-store";
import { contentEndFrame } from "@/model/doc";
import { framesToTimecode } from "@/lib/timecode";
import {
  createCompositor,
  disposeCompositor,
  renderBlackFrame,
  type Compositor,
} from "@/renderer/compositor";
import {
  startPreview,
  invalidatePreview,
  type PreviewScheduler,
} from "@/playback/scheduler";
import { baseSizeForScale, chooseBaseScale } from "@/playback/preview-quality";
import { uiState } from "@/stores/ui-store";
import DebugHud from "./DebugHud";
import {
  isPlaying,
  pause,
  play,
  seekToFrame,
  shuttle,
  togglePlayback,
} from "@/playback/transport";

/**
 * The largest device pixel ratio worth rendering for.
 *
 * Beyond 2 the extra pixels cost fill rate for a difference nobody has reported
 * seeing in a moving picture.
 */
const MAX_PIXEL_RATIO = 2;

const PreviewPanel: Component = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let compositor: Compositor | null = null;
  const [glReady, setGlReady] = createSignal(false);
  /** A signal rather than a local, so the HUD can read it once it exists. */
  const [scheduler, setScheduler] = createSignal<PreviewScheduler | null>(null);

  /**
   * Which of `BASE_SCALES` the preview renders at when nothing is under load.
   *
   * Held here rather than in the scheduler because it is a property of the
   * panel — how big the picture is on screen — while the rung below it is
   * scheduling policy. Moved only by the observer below, which is what keeps a
   * splitter drag from reallocating render targets continuously.
   */
  const [baseScale, setBaseScale] = createSignal(0);

  /**
   * The size the preview renders at with the playhead settled.
   *
   * The top of the quality ladder rather than a fixed size: the scheduler
   * scales the render targets below this when a frame takes too long, and
   * returns here whenever the playhead settles. The canvas buffer is this size,
   * so a rung change reallocates render targets and not the drawing buffer, and
   * the final blit presents the smaller picture upscaled.
   */
  const previewSize = () => baseSizeForScale(doc().sequence, baseScale());

  /**
   * How wide the picture is on screen, in device pixels.
   *
   * Measured from the container rather than the canvas: the canvas is sized by
   * its own drawing buffer when no stylesheet applies, so measuring it would
   * feed the buffer size back into the choice of buffer size and shrink away.
   * `object-contain` is what makes this the fitted width rather than the box.
   */
  const displayedWidth = (rect: DOMRectReadOnly): number => {
    const sequence = doc().sequence;
    const fitted = Math.min(
      rect.width,
      (rect.height * sequence.width) / sequence.height,
    );
    return fitted * Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  };

  onMount(() => {
    if (!canvasRef) return;

    const { width, height } = previewSize();
    canvasRef.width = width;
    canvasRef.height = height;

    // At the preview size, not the sequence size: building it full-size and
    // resizing afterwards allocated a whole set of 4K buffers to discard.
    compositor = createCompositor(canvasRef, { width, height });
    if (!compositor) {
      console.warn("WebGL2 compositor failed to initialize");
      return;
    }

    setGlReady(true);
    renderBlackFrame(compositor);
    // The panel owns the base size; the scheduler owns the rung below it, and
    // therefore owns every call to `resizeCompositor`. Two owners of the render
    // target size would fight each frame, one restoring what the other shrank.
    setScheduler(startPreview(compositor, { baseSize: previewSize }));

    // Opening a project of a different resolution changes what the preview
    // should render at. The render loop cannot observe that on its own.
    createEffect(() => {
      const next = previewSize();
      if (!compositor || !canvasRef) return;
      if (canvasRef.width === next.width && canvasRef.height === next.height) return;

      canvasRef.width = next.width;
      canvasRef.height = next.height;
      invalidatePreview(compositor);
    });

    // A CSS resize keeps the buffer but can drop what was presented, so the
    // picture has to be drawn again — and it is also the only signal that the
    // base size may now be wrong for the panel.
    if (containerRef) {
      const observer = new ResizeObserver(([entry]) => {
        setBaseScale((current) =>
          chooseBaseScale(
            current,
            doc().sequence.width,
            displayedWidth(entry.contentRect),
          ),
        );
        if (compositor) invalidatePreview(compositor);
      });
      observer.observe(containerRef);
      onCleanup(() => observer.disconnect());
    }
  });

  onCleanup(() => {
    scheduler()?.stop();
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
          {/*
            Sized by CSS to fill the panel, with the drawing buffer fitted
            inside it by `object-contain`. The buffer used to set the element
            size, which meant a smaller buffer drew a smaller picture — and,
            once the buffer followed the panel, would have shrunk itself away.
          */}
          <canvas
            ref={canvasRef}
            class="w-full h-full object-contain border border-border/30 rounded"
          />
          {!glReady() && (
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span class="text-muted-foreground/30 text-lg font-semibold">
                {doc().sequence.width} × {doc().sequence.height}
              </span>
            </div>
          )}
          <Show when={uiState.showDebugHud}>
            <DebugHud preview={() => scheduler()?.stats() ?? null} />
          </Show>
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
