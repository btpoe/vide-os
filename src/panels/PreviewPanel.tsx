import { Component, onMount, onCleanup, createSignal } from "solid-js";
import {
  projectState,
  setPlayhead,
  togglePlayback,
} from "@/stores/project-store";
import {
  createCompositor,
  disposeCompositor,
  renderBlackFrame,
  type Compositor,
} from "@/renderer/compositor";
import {
  createPlaybackEngine,
  startRenderLoop,
  disposePlaybackEngine,
  type PlaybackEngine,
} from "@/renderer/playback-engine";

const PreviewPanel: Component = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  let compositor: Compositor | null = null;
  let engine: PlaybackEngine | null = null;
  const [glReady, setGlReady] = createSignal(false);

  onMount(() => {
    if (!canvasRef) return;

    // Set canvas to half project resolution for performance
    canvasRef.width = Math.round(projectState.width / 2);
    canvasRef.height = Math.round(projectState.height / 2);

    compositor = createCompositor(canvasRef);
    if (!compositor) {
      console.warn("WebGL2 compositor failed to initialize");
      return;
    }

    setGlReady(true);
    renderBlackFrame(compositor);

    // Start the render loop
    engine = createPlaybackEngine(compositor);
    startRenderLoop(engine);
  });

  onCleanup(() => {
    if (engine) disposePlaybackEngine(engine);
    if (compositor) disposeCompositor(compositor);
  });

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * projectState.fps);
    return `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
  };

  return (
    <div class="h-full flex flex-col bg-black">
      {/* Canvas area */}
      <div class="flex-1 flex items-center justify-center p-2 min-h-0">
        <div class="relative w-full h-full flex items-center justify-center">
          <canvas
            ref={canvasRef}
            class="max-w-full max-h-full object-contain border border-border/30 rounded"
          />
          {!glReady() && (
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span class="text-muted-foreground/30 text-lg font-semibold">
                {projectState.width} × {projectState.height}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Transport controls */}
      <div class="flex items-center justify-center gap-2 py-2 px-3 border-t border-border bg-card">
        <button
          class="p-1.5 text-sm rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onClick={() => setPlayhead(0)}
          title="Go to start (Home)"
        >
          ⏮
        </button>
        <button
          class="p-1.5 text-sm rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onClick={() =>
            setPlayhead(Math.max(0, projectState.playheadPosition - 5))
          }
          title="Rewind 5s (J)"
        >
          ⏪
        </button>
        <button
          class={`p-2 text-base rounded-full ${
            projectState.isPlaying
              ? "bg-destructive text-destructive-foreground"
              : "bg-primary text-primary-foreground"
          } hover:opacity-90`}
          onClick={() => togglePlayback()}
          title="Play/Pause (Space)"
        >
          {projectState.isPlaying ? "⏸" : "▶"}
        </button>
        <button
          class="p-1.5 text-sm rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onClick={() =>
            setPlayhead(
              Math.min(
                projectState.duration,
                projectState.playheadPosition + 5,
              ),
            )
          }
          title="Forward 5s (L)"
        >
          ⏩
        </button>
        <button
          class="p-1.5 text-sm rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onClick={() => setPlayhead(projectState.duration)}
          title="Go to end (End)"
        >
          ⏭
        </button>
        <div class="mx-3 font-mono text-xs text-muted-foreground">
          {formatTime(projectState.playheadPosition)}
        </div>
        <div class="flex-1" />
        <button
          class="px-2 py-1 text-[10px] rounded bg-secondary text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (canvasRef) {
              if (document.fullscreenElement) {
                document.exitFullscreen();
              } else {
                canvasRef.requestFullscreen().catch(() => {});
              }
            }
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
