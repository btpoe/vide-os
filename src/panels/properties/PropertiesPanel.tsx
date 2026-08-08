import { Component, Show, For, createMemo, createSignal } from "solid-js";
import {
  doc,
  assets,
  setClipSettings,
  setEffectEnabled,
  removeEffectFromClip,
  moveEffect,
  setClipTransition,
  removeClipTransition,
  updateTextOverlay,
  clipAudioSettings,
  setClipFade,
  setClipLinkedAudio,
  setClipSpeed,
} from "@/stores/project-store";
import { timelineState } from "@/stores/timeline-store";
import { EFFECT_DEFINITIONS } from "@/renderer/effects-pipeline";
import { TRANSITION_DEFINITIONS } from "@/renderer/transitions";
import { clipParamPath, effectParam } from "@/model/edits";
import { framesToSeconds, framesToTimecode, type FrameRate } from "@/lib/timecode";
import type { BlendMode, FitMode, TextStyle } from "@/model/doc";
import { ParamRow } from "./ParamRow";

/**
 * Everything about the selected clip.
 *
 * Reads the document directly — frames, `kind`, `source`, animatables — rather
 * than the seconds-shaped compatibility projection the panels were written
 * against. The projection exists to let the model rewrite land before the
 * panel rewrites; this panel no longer needs it.
 */

const BLEND_MODES: BlendMode[] = ["normal", "add", "screen", "multiply"];
const FIT_MODES: FitMode[] = ["contain", "cover", "fill", "none"];

const Section: Component<{ title: string; children: unknown }> = (props) => (
  <div>
    <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
      {props.title}
    </div>
    {props.children as never}
  </div>
);

const PropRow: Component<{ label: string; value: string }> = (props) => (
  <div class="flex items-center gap-2">
    <label class="text-xs text-muted-foreground w-16 shrink-0">{props.label}</label>
    <span class="text-xs text-foreground truncate">{props.value}</span>
  </div>
);

const PropertiesPanel: Component = () => {
  /** The single selected clip, or null when zero or many are selected. */
  const selection = createMemo(() => {
    if (timelineState.selectedClips.length !== 1) return null;
    const ref = timelineState.selectedClips[0];
    const track = doc().tracks.find((t) => t.id === ref.trackId);
    const clip = track?.clips.find((c) => c.id === ref.clipId);
    if (!track || !clip) return null;
    const source = clip.source;
    const asset =
      source.type === "asset"
        ? assets().find((a) => a.id === source.assetId)
        : undefined;
    return { track, clip, asset };
  });

  const rate = () => doc().sequence.frameRate;
  const timecode = (frames: number) => framesToTimecode(frames, rate());

  /** The transition arriving into this clip, if there is one. */
  const transitionIn = createMemo(() => {
    const current = selection();
    if (!current) return undefined;
    return current.track.transitions.find((t) => t.rightClipId === current.clip.id);
  });

  const audio = createMemo(() => {
    const current = selection();
    if (!current) return null;
    return clipAudioSettings(current.track.id, current.clip.id);
  });

  return (
    <div class="h-full flex flex-col text-sm">
      <Show
        when={selection()}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2 p-4 text-center">
            <span class="text-2xl">🎬</span>
            <span>Select a clip to edit properties</span>
            <Show when={timelineState.selectedClips.length > 1}>
              <span class="text-[10px]">
                {timelineState.selectedClips.length} clips selected — select one to edit
              </span>
            </Show>
          </div>
        }
      >
        {(current) => {
          const trackId = () => current().track.id;
          const clipId = () => current().clip.id;
          const isVideo = () => current().track.kind === "video";

          return (
            <div class="flex-1 overflow-auto p-3 space-y-4">
              <Section title="Clip Info">
                <div class="space-y-1.5">
                  <PropRow
                    label="Name"
                    value={
                      current().asset?.name ??
                      (current().clip.source.type === "text" ? "Title" : "Clip")
                    }
                  />
                  <PropRow label="Track" value={current().track.name} />
                  <PropRow label="Start" value={timecode(current().clip.startFrame)} />
                  <PropRow
                    label="Duration"
                    value={timecode(current().clip.durationFrames)}
                  />
                  <PropRow
                    label="In Point"
                    value={timecode(current().clip.inPointFrames)}
                  />

                  <Show when={current().asset}>
                    {(asset) => (
                      <Show when={asset().width && asset().height}>
                        <PropRow
                          label="Source"
                          value={`${asset().width}×${asset().height}`}
                        />
                      </Show>
                    )}
                  </Show>
                </div>
              </Section>

              <Section title="Speed">
                <SpeedControls
                  trackId={trackId()}
                  clipId={clipId()}
                  speed={current().clip.speed}
                  durationFrames={current().clip.durationFrames}
                  rate={rate()}
                />
              </Section>

              <Show when={isVideo()}>
                <Section title="Transform">
                  <div class="space-y-1.5">
                    <ParamRow
                      trackId={trackId()}
                      clipId={clipId()}
                      target={clipParamPath("transform.x")}
                      label="Position X"
                      min={-2}
                      max={2}
                      step={0.005}
                    />
                    <ParamRow
                      trackId={trackId()}
                      clipId={clipId()}
                      target={clipParamPath("transform.y")}
                      label="Position Y"
                      min={-2}
                      max={2}
                      step={0.005}
                    />
                    <ParamRow
                      trackId={trackId()}
                      clipId={clipId()}
                      target={clipParamPath("transform.scaleX")}
                      label="Scale X"
                      min={0}
                      max={4}
                      step={0.01}
                    />
                    <ParamRow
                      trackId={trackId()}
                      clipId={clipId()}
                      target={clipParamPath("transform.scaleY")}
                      label="Scale Y"
                      min={0}
                      max={4}
                      step={0.01}
                    />
                    <ParamRow
                      trackId={trackId()}
                      clipId={clipId()}
                      target={clipParamPath("transform.rotation")}
                      label="Rotation"
                      min={-360}
                      max={360}
                      step={0.5}
                      format={(v) => `${v.toFixed(1)}°`}
                    />
                    <ParamRow
                      trackId={trackId()}
                      clipId={clipId()}
                      target={clipParamPath("opacity")}
                      label="Opacity"
                      min={0}
                      max={100}
                      step={1}
                      toDisplay={(v) => v * 100}
                      fromDisplay={(v) => v / 100}
                      format={(v) => `${v.toFixed(0)}%`}
                    />

                    {/* Anchor is not animatable: it defines what the other
                        values are relative to, and animating the origin of a
                        rotation is a way to confuse yourself. */}
                    <div class="flex items-center gap-1 pt-1">
                      <label class="text-[10px] text-muted-foreground w-14 shrink-0 ml-9">
                        Anchor
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={current().clip.transform.anchorX}
                        onChange={(e) =>
                          setClipSettings(trackId(), clipId(), {
                            anchorX: parseFloat(e.currentTarget.value),
                          })
                        }
                        class="w-14 px-1 py-0.5 text-[10px] text-right font-mono bg-input border border-border rounded text-foreground"
                        title="Anchor X, 0..1 within the layer"
                      />
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={current().clip.transform.anchorY}
                        onChange={(e) =>
                          setClipSettings(trackId(), clipId(), {
                            anchorY: parseFloat(e.currentTarget.value),
                          })
                        }
                        class="w-14 px-1 py-0.5 text-[10px] text-right font-mono bg-input border border-border rounded text-foreground"
                        title="Anchor Y, 0..1 within the layer"
                      />
                    </div>
                  </div>
                </Section>

                <Section title="Crop">
                  <div class="space-y-1.5">
                    <For
                      each={
                        [
                          ["crop.left", "Left"],
                          ["crop.right", "Right"],
                          ["crop.top", "Top"],
                          ["crop.bottom", "Bottom"],
                        ] as const
                      }
                    >
                      {([path, label]) => (
                        <ParamRow
                          trackId={trackId()}
                          clipId={clipId()}
                          target={clipParamPath(path)}
                          label={label}
                          min={0}
                          max={100}
                          step={0.5}
                          toDisplay={(v) => v * 100}
                          fromDisplay={(v) => v / 100}
                          format={(v) => `${v.toFixed(1)}%`}
                        />
                      )}
                    </For>
                  </div>
                </Section>

                <Section title="Compositing">
                  <div class="space-y-2">
                    <div class="flex items-center gap-2">
                      <label class="text-[10px] text-muted-foreground w-14 shrink-0">
                        Blend
                      </label>
                      <select
                        value={current().clip.blend}
                        onChange={(e) =>
                          setClipSettings(trackId(), clipId(), {
                            blend: e.currentTarget.value as BlendMode,
                          })
                        }
                        class="flex-1 px-1 py-0.5 text-[10px] bg-input border border-border rounded text-foreground"
                      >
                        <For each={BLEND_MODES}>
                          {(mode) => <option value={mode}>{mode}</option>}
                        </For>
                      </select>
                    </div>
                    <div class="flex items-center gap-2">
                      <label class="text-[10px] text-muted-foreground w-14 shrink-0">
                        Fit
                      </label>
                      <select
                        value={current().clip.fit}
                        onChange={(e) =>
                          setClipSettings(trackId(), clipId(), {
                            fit: e.currentTarget.value as FitMode,
                          })
                        }
                        class="flex-1 px-1 py-0.5 text-[10px] bg-input border border-border rounded text-foreground"
                      >
                        <For each={FIT_MODES}>
                          {(mode) => <option value={mode}>{mode}</option>}
                        </For>
                      </select>
                    </div>
                    <label class="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={current().clip.enabled}
                        onChange={(e) =>
                          setClipSettings(trackId(), clipId(), {
                            enabled: e.currentTarget.checked,
                          })
                        }
                        class="accent-primary"
                      />
                      Visible
                    </label>
                  </div>
                </Section>
              </Show>

              <Show when={current().clip.source.type === "text"}>
                <Section title="Text">
                  <TextControls
                    trackId={trackId()}
                    clipId={clipId()}
                    style={
                      current().clip.source.type === "text"
                        ? // Narrowed by the Show above.
                          (current().clip.source as { type: "text"; style: TextStyle })
                            .style
                        : null
                    }
                  />
                </Section>
              </Show>

              <Show when={audio()}>
                {(settings) => (
                  <Section title="Audio">
                    <div class="space-y-1.5">
                      <ParamRow
                        trackId={trackId()}
                        clipId={clipId()}
                        target={clipParamPath("volume")}
                        label="Volume"
                        min={0}
                        max={200}
                        step={1}
                        toDisplay={(v) => v * 100}
                        fromDisplay={(v) => v / 100}
                        format={(v) => `${v.toFixed(0)}%`}
                      />
                      <ParamRow
                        trackId={trackId()}
                        clipId={clipId()}
                        target={clipParamPath("pan")}
                        label="Pan"
                        min={-1}
                        max={1}
                        step={0.01}
                      />
                      <div class="flex items-center gap-1">
                        <label class="text-[10px] text-muted-foreground w-14 shrink-0 ml-9">
                          Fade in
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={settings().maxFadeSec}
                          step={0.05}
                          value={settings().fadeInSec}
                          onInput={(e) =>
                            setClipFade(
                              trackId(),
                              clipId(),
                              "in",
                              parseFloat(e.currentTarget.value),
                            )
                          }
                          class="flex-1 h-1 accent-primary cursor-pointer"
                        />
                        <span class="w-14 text-[10px] text-right font-mono text-muted-foreground">
                          {settings().fadeInSec.toFixed(2)}s
                        </span>
                      </div>
                      <div class="flex items-center gap-1">
                        <label class="text-[10px] text-muted-foreground w-14 shrink-0 ml-9">
                          Fade out
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={settings().maxFadeSec}
                          step={0.05}
                          value={settings().fadeOutSec}
                          onInput={(e) =>
                            setClipFade(
                              trackId(),
                              clipId(),
                              "out",
                              parseFloat(e.currentTarget.value),
                            )
                          }
                          class="flex-1 h-1 accent-primary cursor-pointer"
                        />
                        <span class="w-14 text-[10px] text-right font-mono text-muted-foreground">
                          {settings().fadeOutSec.toFixed(2)}s
                        </span>
                      </div>
                      <Show when={isVideo() && current().asset?.hasAudio}>
                        <label class="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer ml-9">
                          <input
                            type="checkbox"
                            checked={settings().linkedAudio}
                            onChange={(e) =>
                              setClipLinkedAudio(
                                trackId(),
                                clipId(),
                                e.currentTarget.checked,
                              )
                            }
                            class="accent-primary"
                          />
                          Include this clip&rsquo;s audio
                        </label>
                      </Show>
                    </div>
                  </Section>
                )}
              </Show>

              <Show when={isVideo()}>
                <Section title="Transition In">
                  <div class="flex flex-wrap gap-1">
                    <For each={TRANSITION_DEFINITIONS}>
                      {(definition) => {
                        const active = () => transitionIn()?.type === definition.id;
                        return (
                          <button
                            class={`px-2 py-1 text-[10px] rounded border ${
                              active()
                                ? "bg-primary/20 border-primary text-primary"
                                : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => {
                              if (active()) removeClipTransition(trackId(), clipId());
                              else
                                setClipTransition(trackId(), clipId(), {
                                  type: definition.id,
                                  duration: 0.5,
                                });
                            }}
                          >
                            {definition.icon} {definition.name}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                  <Show
                    when={transitionIn()}
                    fallback={
                      <div class="mt-1 text-[10px] text-muted-foreground/60 italic">
                        Needs a clip butted against this one, with spare frames on both
                        sides to overlap.
                      </div>
                    }
                  >
                    {(transition) => (
                      <div class="mt-2 flex items-center gap-2">
                        <label class="text-[10px] text-muted-foreground w-16 shrink-0">
                          Duration
                        </label>
                        <input
                          type="range"
                          min={0.1}
                          max={2}
                          step={0.1}
                          value={framesToSeconds(transition().durationFrames, rate())}
                          onInput={(e) =>
                            setClipTransition(trackId(), clipId(), {
                              type: transition().type,
                              duration: parseFloat(e.currentTarget.value),
                            })
                          }
                          class="flex-1 h-1 accent-primary cursor-pointer"
                        />
                        <span class="text-[10px] text-muted-foreground w-14 text-right font-mono">
                          {transition().durationFrames}f
                        </span>
                      </div>
                    )}
                  </Show>
                </Section>
              </Show>

              <Section title={`Effects (${current().clip.effects.length})`}>
                <Show
                  when={current().clip.effects.length > 0}
                  fallback={
                    <div class="text-[10px] text-muted-foreground/60 italic">
                      No effects applied — click an effect in the Effects panel to add
                    </div>
                  }
                >
                  <div class="space-y-2">
                    <For each={current().clip.effects}>
                      {(effect, index) => (
                        <EffectCard
                          trackId={trackId()}
                          clipId={clipId()}
                          effectId={effect.id}
                          definitionId={effect.definitionId}
                          enabled={effect.enabled}
                          index={index()}
                          count={current().clip.effects.length}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Section>
            </div>
          );
        }}
      </Show>
    </div>
  );
};

const SPEED_PRESETS = [0.25, 0.5, 1, 2, 4];

/**
 * Constant-speed retime.
 *
 * Pitch is not preserved: a slowed clip sounds lower. Web Audio's
 * `playbackRate` resamples, and there is no `preservesPitch` on an
 * `AudioBufferSourceNode` — keeping pitch needs a time-stretcher, which is not
 * built. Saying so beats a checkbox that does nothing, which is what most of
 * this panel used to be.
 */
const SpeedControls: Component<{
  trackId: string;
  clipId: string;
  speed: number;
  durationFrames: number;
  rate: FrameRate;
}> = (props) => (
  <div class="space-y-2">
    <div class="flex items-center gap-1">
      <input
        type="range"
        min={0.25}
        max={4}
        step={0.05}
        value={props.speed}
        onInput={(e) =>
          setClipSpeed(props.trackId, props.clipId, parseFloat(e.currentTarget.value))
        }
        class="flex-1 h-1 accent-primary cursor-pointer"
      />
      <input
        type="number"
        min={0.25}
        max={4}
        step={0.05}
        value={Number(props.speed.toFixed(2))}
        onChange={(e) => {
          const parsed = parseFloat(e.currentTarget.value);
          if (Number.isFinite(parsed))
            setClipSpeed(props.trackId, props.clipId, parsed);
        }}
        class="w-14 shrink-0 px-1 py-0.5 text-[10px] text-right font-mono bg-input border border-border rounded text-foreground"
      />
      <span class="text-[10px] text-muted-foreground w-3">×</span>
    </div>

    <div class="flex gap-1">
      <For each={SPEED_PRESETS}>
        {(preset) => (
          <button
            class={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
              Math.abs(props.speed - preset) < 0.001
                ? "bg-primary/20 border-primary text-primary"
                : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setClipSpeed(props.trackId, props.clipId, preset)}
          >
            {preset}×
          </button>
        )}
      </For>
    </div>

    <div class="text-[10px] text-muted-foreground">
      {framesToTimecode(props.durationFrames, props.rate)} on the timeline
      <Show when={Math.abs(props.speed - 1) > 0.001}>
        <span class="text-muted-foreground/60">
          {" "}
          · audio is pitched {props.speed > 1 ? "up" : "down"}
        </span>
      </Show>
    </div>
  </div>
);

/** One effect and its parameters. Order in the chain changes the picture. */
const EffectCard: Component<{
  trackId: string;
  clipId: string;
  effectId: string;
  definitionId: string;
  enabled: boolean;
  index: number;
  count: number;
}> = (props) => {
  const [expanded, setExpanded] = createSignal(true);
  const definition = () => EFFECT_DEFINITIONS.find((d) => d.id === props.definitionId);
  const uniforms = () =>
    definition()?.uniforms.filter((u) => !u.hidden && u.type === "float") ?? [];

  return (
    <div class="bg-secondary/40 rounded overflow-hidden">
      <div class="flex items-center gap-1 px-2 py-1.5">
        <button
          class="text-[10px] text-muted-foreground hover:text-foreground w-4"
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? "▾" : "▸"}
        </button>
        <input
          type="checkbox"
          checked={props.enabled}
          onChange={(e) =>
            setEffectEnabled(
              props.trackId,
              props.clipId,
              props.effectId,
              e.currentTarget.checked,
            )
          }
          class="accent-primary"
          title={props.enabled ? "Disable effect" : "Enable effect"}
        />
        <span
          class={`flex-1 text-xs font-medium truncate ${
            props.enabled ? "" : "text-muted-foreground line-through"
          }`}
        >
          {definition()?.name ?? props.definitionId}
        </span>
        <button
          class="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={props.index === 0}
          onClick={() =>
            moveEffect(props.trackId, props.clipId, props.effectId, props.index - 1)
          }
          title="Move earlier in the chain"
        >
          ▲
        </button>
        <button
          class="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={props.index === props.count - 1}
          onClick={() =>
            moveEffect(props.trackId, props.clipId, props.effectId, props.index + 1)
          }
          title="Move later in the chain"
        >
          ▼
        </button>
        <button
          class="text-[10px] text-destructive hover:text-destructive/80"
          onClick={() =>
            removeEffectFromClip(props.trackId, props.clipId, props.effectId)
          }
          title="Remove effect"
        >
          ✕
        </button>
      </div>
      <Show when={expanded() && uniforms().length > 0}>
        <div class="px-2 pb-2 space-y-1.5">
          <For each={uniforms()}>
            {(uniform) => (
              <ParamRow
                trackId={props.trackId}
                clipId={props.clipId}
                target={effectParam(props.effectId, uniform.name)}
                label={uniform.label}
                min={uniform.min ?? 0}
                max={uniform.max ?? 1}
                step={uniform.step ?? 0.01}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

/** Title text and styling. Text clips are ordinary layers with a drawn source. */
const TextControls: Component<{
  trackId: string;
  clipId: string;
  style: TextStyle | null;
}> = (props) => (
  <Show when={props.style}>
    {(style) => (
      <div class="space-y-2">
        <textarea
          value={style().text}
          onInput={(e) =>
            updateTextOverlay(props.trackId, props.clipId, {
              text: e.currentTarget.value,
            })
          }
          class="w-full px-2 py-1.5 text-xs bg-input border border-border rounded text-foreground resize-none"
          rows={2}
          placeholder="Enter text..."
        />
        <div class="flex items-center gap-2">
          <label class="text-[10px] text-muted-foreground w-16 shrink-0">
            Font Size
          </label>
          <input
            type="range"
            min={12}
            max={200}
            step={2}
            value={style().fontSize}
            onInput={(e) =>
              updateTextOverlay(props.trackId, props.clipId, {
                fontSize: parseInt(e.currentTarget.value),
              })
            }
            class="flex-1 h-1 accent-primary cursor-pointer"
          />
          <span class="text-[10px] text-muted-foreground w-10 text-right font-mono">
            {style().fontSize}px
          </span>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-[10px] text-muted-foreground w-16 shrink-0">Color</label>
          <input
            type="color"
            value={style().color}
            onInput={(e) =>
              updateTextOverlay(props.trackId, props.clipId, {
                color: e.currentTarget.value,
              })
            }
            class="w-6 h-6 rounded border border-border cursor-pointer"
          />
          <span class="text-[10px] text-muted-foreground font-mono">
            {style().color}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-[10px] text-muted-foreground w-16 shrink-0">Weight</label>
          <div class="flex gap-1">
            <For each={["normal", "bold"] as const}>
              {(weight) => (
                <button
                  class={`px-2 py-0.5 text-[10px] rounded border ${
                    style().fontWeight === weight
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() =>
                    updateTextOverlay(props.trackId, props.clipId, {
                      fontWeight: weight,
                    })
                  }
                >
                  {weight}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-[10px] text-muted-foreground w-16 shrink-0">Align</label>
          <div class="flex gap-1">
            <For each={["left", "center", "right"] as const}>
              {(align) => (
                <button
                  class={`px-2 py-0.5 text-[10px] rounded border ${
                    style().align === align
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() =>
                    updateTextOverlay(props.trackId, props.clipId, { align })
                  }
                >
                  {align}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    )}
  </Show>
);

export default PropertiesPanel;
