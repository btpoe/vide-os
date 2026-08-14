/**
 * The debug HUD.
 *
 * Every number here was already being counted and none of it was visible. The
 * frame-leak counter in particular is the one measurement that says whether the
 * `.close()` discipline the media engine depends on is actually being kept, and
 * until now it could only be read from a test.
 *
 * Polled rather than made reactive: these counters change on the render loop's
 * schedule, and driving Solid's reactivity from a 60 Hz loop to update text
 * nobody is reading closely would cost more than the thing it measures. Four
 * times a second is fast enough to see a leak climb and slow enough to read.
 */

import { Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import { mediaEngine } from "@/media/engine";
import { rungScale } from "@/playback/preview-quality";
import type { PreviewStats } from "@/playback/scheduler";

/** How often the counters are re-read, in milliseconds. */
const POLL_MS = 250;

type EngineStats = ReturnType<typeof mediaEngine.stats>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const Row: Component<{ label: string; value: string; warn?: boolean }> = (props) => (
  <>
    <span class="text-white/40">{props.label}</span>
    <span class={props.warn ? "text-amber-400" : "text-white/90"}>{props.value}</span>
  </>
);

/**
 * Reads the preview scheduler's and the media engine's counters.
 *
 * `preview` is a getter rather than a value because the scheduler outlives no
 * more than the panel does, and the panel mounts the HUD before it has one.
 */
const DebugHud: Component<{ preview: () => PreviewStats | null }> = (props) => {
  const [preview, setPreview] = createSignal<PreviewStats | null>(null);
  const [engine, setEngine] = createSignal<EngineStats | null>(null);

  onMount(() => {
    const sample = () => {
      setPreview(props.preview());
      setEngine(mediaEngine.stats());
    };
    sample();
    const timer = setInterval(sample, POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const hitRate = () => {
    const cache = engine()?.cache;
    if (!cache) return "—";
    const total = cache.hits + cache.misses;
    return total === 0 ? "—" : `${Math.round((cache.hits / total) * 100)}%`;
  };

  return (
    <div class="absolute top-2 left-2 pointer-events-none select-none rounded bg-black/70 px-2.5 py-2 font-mono text-[10px] leading-[1.45] backdrop-blur-sm">
      <div class="grid grid-cols-[auto_auto] gap-x-3">
        <Show when={preview()}>
          {(stats) => (
            <>
              <Row
                label="render"
                value={`${stats().lastRenderMs.toFixed(1)} ms · ${stats().lastIntervalMs.toFixed(1)} ms gap`}
              />
              <Row
                label="quality"
                value={`${stats().size.width}×${stats().size.height} · ${scaleLabel(stats())}`}
                // A rung below the top means the preview is giving up
                // resolution to keep the frame rate, which is worth seeing.
                warn={stats().ladder.rung > 0}
              />
              <Row
                label="dropped"
                value={`${stats().droppedFrames} of ${stats().renderedFrames + stats().droppedFrames}`}
                warn={stats().droppedFrames > 0}
              />
              {/*
                Passes that found nothing decoded and held the last picture.
                A climbing number here is the decoder failing to keep up — the
                thing that used to show as the preview flashing black.
              */}
              <Row
                label="held"
                value={`${stats().heldFrames}`}
                warn={stats().heldFrames > 0}
              />
            </>
          )}
        </Show>
        <Show when={engine()}>
          {(stats) => (
            <>
              <Row
                label="decoders"
                value={`${stats().decoders} / ${stats().budget}`}
                warn={stats().decoders >= stats().budget}
              />
              <Row
                label="frames"
                value={`${stats().cache.entries} cached · ${formatBytes(stats().cache.bytes)} of ${formatBytes(stats().cache.budgetBytes)}`}
              />
              <Row label="hit rate" value={hitRate()} />
              {/*
                Created minus closed. A cached frame is legitimately open, so a
                number here is expected — what matters is that it tracks the
                cache rather than climbing away from it.
              */}
              <Row
                label="open"
                value={`${stats().openFrames} (${stats().cache.created} made, ${stats().cache.closed} closed)`}
                warn={stats().openFrames > stats().cache.entries + 8}
              />
            </>
          )}
        </Show>
      </div>
    </div>
  );
};

/** "full", or the fraction of the base the render targets are at. */
function scaleLabel(stats: PreviewStats): string {
  const scale = rungScale(stats.ladder);
  return scale === 1 ? "full" : `1/${Math.round(1 / scale)}`;
}

export default DebugHud;
