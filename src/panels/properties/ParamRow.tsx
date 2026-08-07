import { Component, Show, For, createMemo, createSignal } from "solid-js";
import {
  readParam,
  writeParam,
  toggleParamKey,
  toggleParamAnimation,
  clearParamKeys,
  setParamKeyInterp,
  seekToAdjacentKey,
  setPlayheadFrame,
  playheadFrame,
  doc,
} from "@/stores/project-store";
import type { ParamTarget } from "@/model/edits";
import type { Interp } from "@/lib/animation";

/**
 * One animatable parameter.
 *
 * Every property in this panel — clip opacity, a transform axis, a crop edge,
 * an effect uniform — is the same thing: a number with optional keyframes. So
 * they share this row, and all of them get the stopwatch, the diamond, the
 * keyframe strip and the easing picker, rather than only effects having them.
 *
 * This replaces the six controls that rendered as real-looking sliders and had
 * no `onInput` at all.
 */

export interface ParamRowProps {
  trackId: string;
  clipId: string;
  target: ParamTarget;
  label: string;
  min: number;
  max: number;
  step: number;
  /** How the number reads to a human: degrees, percentages, multipliers. */
  format?: (value: number) => string;
  /** Display units, when they differ from stored units. */
  toDisplay?: (value: number) => number;
  fromDisplay?: (value: number) => number;
}

const INTERPS: { id: Interp; label: string }[] = [
  { id: "linear", label: "linear" },
  { id: "bezier", label: "ease" },
  { id: "hold", label: "hold" },
];

export const ParamRow: Component<ParamRowProps> = (props) => {
  const [showStrip, setShowStrip] = createSignal(true);

  const view = createMemo(() => readParam(props.trackId, props.clipId, props.target));

  const clip = createMemo(() =>
    doc()
      .tracks.find((t) => t.id === props.trackId)
      ?.clips.find((c) => c.id === props.clipId),
  );

  /** The playhead in the clip's own frame space — where keyframes live. */
  const localFrame = () => {
    const target = clip();
    return target ? playheadFrame() - target.startFrame : 0;
  };

  const toDisplay = (value: number) =>
    props.toDisplay ? props.toDisplay(value) : value;
  const fromDisplay = (value: number) =>
    props.fromDisplay ? props.fromDisplay(value) : value;
  const format = (value: number) =>
    props.format ? props.format(value) : value.toFixed(2);

  const shown = () => {
    const value = view()?.value;
    return toDisplay(typeof value === "number" ? value : 0);
  };

  const commit = (displayValue: number) =>
    writeParam(
      props.trackId,
      props.clipId,
      props.target,
      fromDisplay(displayValue),
      `Set ${props.label.toLowerCase()}`,
    );

  const animated = () => view()?.animated ?? false;
  const keyAtPlayhead = () => view()?.keyedHere ?? false;
  const keyUnderPlayhead = () =>
    view()?.keys.find((k) => k.timeFrames === localFrame());

  /** Position along the strip, 0..100, for a clip-relative frame. */
  const percentOf = (frame: number) => {
    const target = clip();
    if (!target) return 0;
    const fraction = frame / Math.max(1, target.durationFrames);
    return Math.max(0, Math.min(1, fraction)) * 100;
  };

  return (
    <div class="space-y-1">
      <div class="flex items-center gap-1">
        {/*
          The stopwatch turns animation on and off; the diamond adds and
          removes a single key. Conflating the two is how a parameter ends up
          marked animated with no keyframes behind it.
        */}
        <button
          class={`w-4 h-4 shrink-0 text-[10px] transition-colors ${
            animated()
              ? "text-primary"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          }`}
          onClick={() =>
            toggleParamAnimation(props.trackId, props.clipId, props.target)
          }
          title={animated() ? "Stop animating (freeze at playhead)" : "Animate"}
        >
          ⏱
        </button>

        <Show
          when={animated()}
          fallback={<span class="w-4 shrink-0" aria-hidden="true" />}
        >
          <button
            class={`w-4 h-4 shrink-0 text-[10px] transition-colors ${
              keyAtPlayhead()
                ? "text-yellow-400"
                : "text-yellow-400/40 hover:text-yellow-400"
            }`}
            onClick={() => toggleParamKey(props.trackId, props.clipId, props.target)}
            title={keyAtPlayhead() ? "Remove keyframe" : "Add keyframe"}
          >
            {keyAtPlayhead() ? "◆" : "◇"}
          </button>
        </Show>

        <label class="text-[10px] text-muted-foreground w-14 shrink-0 truncate">
          {props.label}
        </label>

        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={shown()}
          onInput={(e) => commit(parseFloat(e.currentTarget.value))}
          class="flex-1 h-1 accent-primary cursor-pointer"
        />

        <input
          type="number"
          min={props.min}
          max={props.max}
          step={props.step}
          value={Number(shown().toFixed(3))}
          onChange={(e) => {
            const parsed = parseFloat(e.currentTarget.value);
            if (Number.isFinite(parsed)) commit(parsed);
          }}
          class="w-14 shrink-0 px-1 py-0.5 text-[10px] text-right font-mono tabular-nums bg-input border border-border rounded text-foreground"
          title={format(shown())}
        />
      </div>

      <Show when={animated()}>
        <div class="ml-9 space-y-1">
          <div class="flex items-center gap-1">
            <button
              class="px-1 text-[9px] text-muted-foreground hover:text-foreground"
              onClick={() =>
                seekToAdjacentKey(props.trackId, props.clipId, props.target, -1)
              }
              title="Previous keyframe"
            >
              ◀
            </button>
            <button
              class="text-[9px] text-muted-foreground hover:text-foreground font-mono"
              onClick={() => setShowStrip(!showStrip())}
              title="Show or hide the keyframe strip"
            >
              {view()?.keys.length ?? 0} key
              {(view()?.keys.length ?? 0) === 1 ? "" : "s"}
            </button>
            <button
              class="px-1 text-[9px] text-muted-foreground hover:text-foreground"
              onClick={() =>
                seekToAdjacentKey(props.trackId, props.clipId, props.target, 1)
              }
              title="Next keyframe"
            >
              ▶
            </button>
            <button
              class="ml-auto px-1 text-[9px] text-destructive/60 hover:text-destructive"
              onClick={() => clearParamKeys(props.trackId, props.clipId, props.target)}
              title="Remove all keyframes"
            >
              ✕
            </button>
          </div>

          <Show when={showStrip()}>
            {/* The strip spans the clip, not the timeline. Click to seek. */}
            <div
              class="relative h-5 bg-secondary/60 rounded border border-border/50 cursor-pointer"
              onClick={(e) => {
                const target = clip();
                if (!target) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const fraction = Math.max(
                  0,
                  Math.min(1, (e.clientX - rect.left) / rect.width),
                );
                setPlayheadFrame(
                  target.startFrame + Math.round(fraction * target.durationFrames),
                );
              }}
            >
              <Show when={view()?.inRange}>
                <div
                  class="absolute top-0 bottom-0 w-px bg-red-500 z-10"
                  style={{ left: `${percentOf(localFrame())}%` }}
                />
              </Show>
              <For each={view()?.keys ?? []}>
                {(key) => (
                  <div
                    class={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border cursor-pointer transition-colors ${
                      key.timeFrames === localFrame()
                        ? "bg-yellow-400 border-yellow-300"
                        : "bg-yellow-400/60 border-yellow-500/40 hover:bg-yellow-400"
                    }`}
                    style={{ left: `${percentOf(key.timeFrames)}%` }}
                    title={`frame ${key.timeFrames} · ${format(
                      toDisplay(typeof key.value === "number" ? key.value : 0),
                    )} · ${key.interp}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const target = clip();
                      if (target) setPlayheadFrame(target.startFrame + key.timeFrames);
                    }}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Easing applies to the key under the playhead. */}
          <Show when={keyUnderPlayhead()}>
            {(key) => (
              <div class="flex gap-1">
                <For each={INTERPS}>
                  {(option) => (
                    <button
                      class={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
                        key().interp === option.id
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() =>
                        setParamKeyInterp(
                          props.trackId,
                          props.clipId,
                          props.target,
                          key().id,
                          option.id,
                        )
                      }
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
};
