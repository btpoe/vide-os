import { Component, Show, For, createMemo, createSignal } from "solid-js";
import {
  projectState,
  removeEffectFromClip,
  updateEffectValue,
  setClipTransition,
  removeClipTransition,
  updateTextOverlay,
  addKeyframe,
  removeKeyframe,
  updateKeyframe,
  removeAllKeyframes,
  getEffectValueAtTime,
  type ClipTransition,
  type ClipEffect,
  type Keyframe,
  type KeyframeEasing,
} from "@/stores/project-store";
import { mediaState } from "@/stores/media-store";
import { timelineState } from "@/stores/timeline-store";
import {
  EFFECT_DEFINITIONS,
  type EffectUniform,
} from "@/renderer/effects-pipeline";
import {
  TRANSITION_DEFINITIONS,
  type TransitionType,
} from "@/renderer/transitions";
import { pushAction } from "@/stores/history-store";
import { formatDuration } from "@/lib/fs-access";

const PropertiesPanel: Component = () => {
  const selectedClipInfo = createMemo(() => {
    if (timelineState.selectedClips.length !== 1) return null;
    const ref = timelineState.selectedClips[0];
    const track = projectState.tracks.find((t) => t.id === ref.trackId);
    const clip = track?.clips.find((c) => c.id === ref.clipId);
    if (!clip || !track) return null;
    const media = mediaState.entries.find((e) => e.id === clip.mediaId);
    return { clip, track, media };
  });

  const PropRow = (props: { label: string; value: string }) => (
    <div class="flex items-center gap-2">
      <label class="text-xs text-muted-foreground w-16 shrink-0">
        {props.label}
      </label>
      <span class="text-xs text-foreground truncate">{props.value}</span>
    </div>
  );

  const PropInput = (props: {
    label: string;
    value: number;
    unit?: string;
    disabled?: boolean;
  }) => (
    <div class="flex items-center gap-2">
      <label class="text-xs text-muted-foreground w-16 shrink-0">
        {props.label}
      </label>
      <input
        type="number"
        value={props.value}
        disabled={props.disabled}
        class="flex-1 px-2 py-1 text-xs bg-input border border-border rounded text-foreground disabled:opacity-50"
      />
      <Show when={props.unit}>
        <span class="text-xs text-muted-foreground w-6">{props.unit}</span>
      </Show>
    </div>
  );

  return (
    <div class="h-full flex flex-col text-sm">
      <Show
        when={selectedClipInfo()}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2 p-4 text-center">
            <span class="text-2xl">🎬</span>
            <span>Select a clip to edit properties</span>
            <Show when={timelineState.selectedClips.length > 1}>
              <span class="text-[10px]">
                {timelineState.selectedClips.length} clips selected — select one
                to edit
              </span>
            </Show>
          </div>
        }
      >
        {(info) => (
          <div class="flex-1 overflow-auto p-3 space-y-4">
            {/* Clip Info */}
            <div>
              <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                Clip Info
              </div>
              <div class="space-y-1.5">
                <PropRow label="Name" value={info().media?.name || "Unknown"} />
                <PropRow label="Type" value={info().track.type} />
                <PropRow label="Track" value={info().track.name} />
                <PropRow
                  label="Start"
                  value={formatDuration(info().clip.startTime)}
                />
                <PropRow
                  label="Duration"
                  value={formatDuration(info().clip.duration)}
                />
                <PropRow
                  label="In Point"
                  value={formatDuration(info().clip.inPoint)}
                />
                <PropRow
                  label="Out Point"
                  value={formatDuration(info().clip.outPoint)}
                />
              </div>
            </div>

            {/* Media Info */}
            <Show when={info().media}>
              {(media) => (
                <div>
                  <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                    Source Media
                  </div>
                  <div class="space-y-1.5">
                    <PropRow label="File" value={media().name} />
                    <Show when={media().width}>
                      <PropRow
                        label="Resolution"
                        value={`${media().width}×${media().height}`}
                      />
                    </Show>
                    <Show when={media().duration}>
                      <PropRow
                        label="Duration"
                        value={formatDuration(media().duration!)}
                      />
                    </Show>
                  </div>
                  <Show when={media().thumbnailUrl}>
                    <div class="mt-2 rounded overflow-hidden border border-border">
                      <img
                        src={media().thumbnailUrl}
                        alt=""
                        class="w-full aspect-video object-cover"
                      />
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            {/* Text Overlay (for text clips) */}
            <Show when={info().clip.textOverlay}>
              <div>
                <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                  Text
                </div>
                <div class="space-y-2">
                  <textarea
                    value={info().clip.textOverlay!.text}
                    onInput={(e) =>
                      updateTextOverlay(info().track.id, info().clip.id, {
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
                      value={info().clip.textOverlay!.fontSize}
                      onInput={(e) =>
                        updateTextOverlay(info().track.id, info().clip.id, {
                          fontSize: parseInt(e.currentTarget.value),
                        })
                      }
                      class="flex-1 h-1 accent-primary cursor-pointer"
                    />
                    <span class="text-[10px] text-muted-foreground w-8 text-right font-mono">
                      {info().clip.textOverlay!.fontSize}px
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-muted-foreground w-16 shrink-0">
                      Color
                    </label>
                    <input
                      type="color"
                      value={info().clip.textOverlay!.color}
                      onInput={(e) =>
                        updateTextOverlay(info().track.id, info().clip.id, {
                          color: e.currentTarget.value,
                        })
                      }
                      class="w-6 h-6 rounded border border-border cursor-pointer"
                    />
                    <span class="text-[10px] text-muted-foreground font-mono">
                      {info().clip.textOverlay!.color}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-muted-foreground w-16 shrink-0">
                      Weight
                    </label>
                    <div class="flex gap-1">
                      <button
                        class={`px-2 py-0.5 text-[10px] rounded border ${
                          info().clip.textOverlay!.fontWeight === "normal"
                            ? "bg-primary/20 border-primary text-primary"
                            : "bg-secondary/50 border-border text-muted-foreground"
                        }`}
                        onClick={() =>
                          updateTextOverlay(info().track.id, info().clip.id, {
                            fontWeight: "normal",
                          })
                        }
                      >
                        Normal
                      </button>
                      <button
                        class={`px-2 py-0.5 text-[10px] rounded border font-bold ${
                          info().clip.textOverlay!.fontWeight === "bold"
                            ? "bg-primary/20 border-primary text-primary"
                            : "bg-secondary/50 border-border text-muted-foreground"
                        }`}
                        onClick={() =>
                          updateTextOverlay(info().track.id, info().clip.id, {
                            fontWeight: "bold",
                          })
                        }
                      >
                        Bold
                      </button>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-muted-foreground w-16 shrink-0">
                      Align
                    </label>
                    <div class="flex gap-1">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button
                          class={`px-2 py-0.5 text-[10px] rounded border ${
                            info().clip.textOverlay!.align === a
                              ? "bg-primary/20 border-primary text-primary"
                              : "bg-secondary/50 border-border text-muted-foreground"
                          }`}
                          onClick={() =>
                            updateTextOverlay(info().track.id, info().clip.id, {
                              align: a,
                            })
                          }
                        >
                          {a === "left" ? "◀" : a === "center" ? "◆" : "▶"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Show>

            {/* Transform */}
            <div>
              <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                Transform
              </div>
              <div class="space-y-1.5">
                <PropInput label="Position X" value={0} unit="px" />
                <PropInput label="Position Y" value={0} unit="px" />
                <PropInput label="Scale" value={100} unit="%" />
                <PropInput label="Rotation" value={0} unit="°" />
              </div>
            </div>

            {/* Opacity */}
            <div>
              <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                Opacity
              </div>
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 bg-secondary rounded-full">
                  <div class="h-full w-full bg-primary rounded-full" />
                </div>
                <span class="text-xs text-muted-foreground w-8 text-right">
                  100%
                </span>
              </div>
            </div>

            {/* Audio (for video/audio clips) */}
            <Show
              when={
                info().track.type === "video" || info().track.type === "audio"
              }
            >
              <div>
                <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                  Audio
                </div>
                <div class="space-y-1.5">
                  <div class="flex items-center gap-2">
                    <label class="text-xs text-muted-foreground w-16 shrink-0">
                      Volume
                    </label>
                    <div class="flex-1 h-1.5 bg-secondary rounded-full">
                      <div class="h-full w-full bg-green-500 rounded-full" />
                    </div>
                    <span class="text-xs text-muted-foreground w-8 text-right">
                      100%
                    </span>
                  </div>
                </div>
              </div>
            </Show>

            {/* Transition */}
            <Show when={info().track.type === "video"}>
              <div>
                <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                  Transition In
                </div>
                <div class="flex flex-wrap gap-1">
                  <For each={TRANSITION_DEFINITIONS}>
                    {(tDef) => {
                      const isActive = () =>
                        info().clip.transition?.type === tDef.id;
                      return (
                        <button
                          class={`px-2 py-1 text-[10px] rounded border ${
                            isActive()
                              ? "bg-primary/20 border-primary text-primary"
                              : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={() => {
                            if (isActive()) {
                              removeClipTransition(
                                info().track.id,
                                info().clip.id,
                              );
                            } else {
                              setClipTransition(
                                info().track.id,
                                info().clip.id,
                                {
                                  type: tDef.id,
                                  duration: 0.5,
                                },
                              );
                            }
                          }}
                        >
                          {tDef.icon} {tDef.name}
                        </button>
                      );
                    }}
                  </For>
                </div>
                <Show when={info().clip.transition}>
                  <div class="mt-2 flex items-center gap-2">
                    <label class="text-[10px] text-muted-foreground w-16 shrink-0">
                      Duration
                    </label>
                    <input
                      type="range"
                      min={0.1}
                      max={2}
                      step={0.1}
                      value={info().clip.transition?.duration ?? 0.5}
                      onInput={(e) => {
                        const dur = parseFloat(e.currentTarget.value);
                        setClipTransition(info().track.id, info().clip.id, {
                          type: info().clip.transition!.type,
                          duration: dur,
                        });
                      }}
                      class="flex-1 h-1 accent-primary cursor-pointer"
                    />
                    <span class="text-[10px] text-muted-foreground w-8 text-right font-mono">
                      {(info().clip.transition?.duration ?? 0.5).toFixed(1)}s
                    </span>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Effects */}
            <div>
              <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                Effects ({info().clip.effects.length})
              </div>
              <Show
                when={info().clip.effects.length > 0}
                fallback={
                  <div class="text-[10px] text-muted-foreground/60 italic">
                    No effects applied — click an effect in the Effects panel to
                    add
                  </div>
                }
              >
                <div class="space-y-2">
                  <For each={info().clip.effects}>
                    {(fx) => {
                      const def = () =>
                        EFFECT_DEFINITIONS.find(
                          (d) => d.id === fx.definitionId,
                        );
                      const [expanded, setExpanded] = createSignal(true);
                      const visibleUniforms = () =>
                        def()?.uniforms.filter(
                          (u) => !u.hidden && u.type === "float",
                        ) || [];

                      const clipRelativeTime = () =>
                        projectState.playheadPosition - info().clip.startTime;

                      return (
                        <div class="bg-secondary/40 rounded overflow-hidden">
                          {/* Effect header */}
                          <div class="flex items-center gap-1 px-2 py-1.5">
                            <button
                              class="text-[10px] text-muted-foreground hover:text-foreground w-4"
                              onClick={() => setExpanded(!expanded())}
                            >
                              {expanded() ? "▾" : "▸"}
                            </button>
                            <span class="flex-1 text-xs font-medium truncate">
                              {def()?.name || fx.definitionId}
                            </span>
                            <button
                              class="text-[10px] text-destructive hover:text-destructive/80"
                              onClick={() => {
                                removeEffectFromClip(
                                  info().track.id,
                                  info().clip.id,
                                  fx.id,
                                );
                                pushAction(
                                  `Remove ${def()?.name || "effect"}`,
                                  "\ud83d\uddd1",
                                  () => {},
                                  () =>
                                    removeEffectFromClip(
                                      info().track.id,
                                      info().clip.id,
                                      fx.id,
                                    ),
                                );
                              }}
                              title="Remove effect"
                            >
                              {"\u2715"}
                            </button>
                          </div>
                          {/* Effect parameters with keyframes */}
                          <Show
                            when={expanded() && visibleUniforms().length > 0}
                          >
                            <div class="px-2 pb-2 space-y-2.5">
                              <For each={visibleUniforms()}>
                                {(uniform) => {
                                  const kfs = () => {
                                    // Read the whole keyframes object to ensure
                                    // SolidJS tracks it (dynamic key access on
                                    // store proxies doesn't track new keys).
                                    const allKfs = fx.keyframes;
                                    if (!allKfs) return [] as Keyframe[];
                                    // Touch Object.keys so SolidJS sees changes
                                    Object.keys(allKfs);
                                    return (
                                      allKfs[uniform.name] || ([] as Keyframe[])
                                    );
                                  };
                                  const hasKeyframes = () => kfs().length > 0;
                                  const [showEasing, setShowEasing] =
                                    createSignal(false);

                                  const currentVal = () => {
                                    if (hasKeyframes()) {
                                      return getEffectValueAtTime(
                                        fx,
                                        uniform.name,
                                        clipRelativeTime(),
                                        uniform.default as number,
                                      );
                                    }
                                    const v = fx.values[uniform.name];
                                    return typeof v === "number"
                                      ? v
                                      : (uniform.default as number);
                                  };

                                  const keyframeAtPlayhead = () =>
                                    kfs().find(
                                      (k) =>
                                        Math.abs(k.time - clipRelativeTime()) <
                                        0.02,
                                    );

                                  const prevKeyframe = () => {
                                    const t = clipRelativeTime();
                                    const before = kfs().filter(
                                      (k) => k.time < t - 0.02,
                                    );
                                    return before.length > 0
                                      ? before[before.length - 1]
                                      : null;
                                  };

                                  const nextKeyframe = () => {
                                    const t = clipRelativeTime();
                                    return (
                                      kfs().find((k) => k.time > t + 0.02) ||
                                      null
                                    );
                                  };

                                  const toggleKeyframeAtPlayhead = () => {
                                    const existing = keyframeAtPlayhead();
                                    if (existing) {
                                      removeKeyframe(
                                        info().track.id,
                                        info().clip.id,
                                        fx.id,
                                        uniform.name,
                                        existing.id,
                                      );
                                      pushAction(
                                        `Remove keyframe`,
                                        "◇",
                                        () => {},
                                        () =>
                                          removeKeyframe(
                                            info().track.id,
                                            info().clip.id,
                                            fx.id,
                                            uniform.name,
                                            existing.id,
                                          ),
                                      );
                                    } else {
                                      const kf = addKeyframe(
                                        info().track.id,
                                        info().clip.id,
                                        fx.id,
                                        uniform.name,
                                        clipRelativeTime(),
                                        currentVal(),
                                      );
                                      pushAction(
                                        `Add keyframe`,
                                        "◆",
                                        () =>
                                          removeKeyframe(
                                            info().track.id,
                                            info().clip.id,
                                            fx.id,
                                            uniform.name,
                                            kf.id,
                                          ),
                                        () =>
                                          addKeyframe(
                                            info().track.id,
                                            info().clip.id,
                                            fx.id,
                                            uniform.name,
                                            clipRelativeTime(),
                                            currentVal(),
                                          ),
                                      );
                                    }
                                  };

                                  const goToPrevKeyframe = () => {
                                    const kf = prevKeyframe();
                                    if (kf) {
                                      import("@/stores/project-store").then(
                                        ({ setPlayhead }) => {
                                          setPlayhead(
                                            info().clip.startTime + kf.time,
                                          );
                                        },
                                      );
                                    }
                                  };

                                  const goToNextKeyframe = () => {
                                    const kf = nextKeyframe();
                                    if (kf) {
                                      import("@/stores/project-store").then(
                                        ({ setPlayhead }) => {
                                          setPlayhead(
                                            info().clip.startTime + kf.time,
                                          );
                                        },
                                      );
                                    }
                                  };

                                  return (
                                    <div class="space-y-1">
                                      {/* Parameter row: label + keyframe toggle + slider + value */}
                                      <div class="flex items-center gap-1">
                                        {/* Keyframe diamond toggle */}
                                        <button
                                          class={`w-4 h-4 flex items-center justify-center text-[10px] shrink-0 transition-colors ${
                                            keyframeAtPlayhead()
                                              ? "text-yellow-400"
                                              : hasKeyframes()
                                                ? "text-yellow-400/50"
                                                : "text-muted-foreground/40 hover:text-muted-foreground"
                                          }`}
                                          onClick={toggleKeyframeAtPlayhead}
                                          title={
                                            keyframeAtPlayhead()
                                              ? "Remove keyframe at playhead"
                                              : "Add keyframe at playhead"
                                          }
                                        >
                                          {keyframeAtPlayhead() ? "◆" : "◇"}
                                        </button>
                                        <label class="text-[10px] text-muted-foreground w-14 shrink-0 truncate">
                                          {uniform.label}
                                        </label>
                                        <input
                                          type="range"
                                          min={uniform.min ?? 0}
                                          max={uniform.max ?? 1}
                                          step={uniform.step ?? 0.01}
                                          value={currentVal()}
                                          onInput={(e) => {
                                            const val = parseFloat(
                                              e.currentTarget.value,
                                            );
                                            if (hasKeyframes()) {
                                              const existing =
                                                keyframeAtPlayhead();
                                              if (existing) {
                                                updateKeyframe(
                                                  info().track.id,
                                                  info().clip.id,
                                                  fx.id,
                                                  uniform.name,
                                                  existing.id,
                                                  { value: val },
                                                );
                                              } else {
                                                addKeyframe(
                                                  info().track.id,
                                                  info().clip.id,
                                                  fx.id,
                                                  uniform.name,
                                                  clipRelativeTime(),
                                                  val,
                                                );
                                              }
                                            } else {
                                              updateEffectValue(
                                                info().track.id,
                                                info().clip.id,
                                                fx.id,
                                                uniform.name,
                                                val,
                                              );
                                            }
                                          }}
                                          class="flex-1 h-1 accent-primary cursor-pointer"
                                        />
                                        <span class="text-[10px] text-muted-foreground w-10 text-right font-mono">
                                          {currentVal().toFixed(2)}
                                        </span>
                                      </div>

                                      {/* Keyframe controls: nav + mini timeline + easing (only when keyframes exist) */}
                                      <Show when={hasKeyframes()}>
                                        <div class="ml-4 space-y-1">
                                          {/* Navigation row */}
                                          <div class="flex items-center gap-1">
                                            <button
                                              class={`px-1 text-[9px] rounded ${
                                                prevKeyframe()
                                                  ? "text-muted-foreground hover:text-foreground"
                                                  : "text-muted-foreground/30 cursor-default"
                                              }`}
                                              onClick={goToPrevKeyframe}
                                              disabled={!prevKeyframe()}
                                              title="Previous keyframe"
                                            >
                                              {"◀"}
                                            </button>
                                            <span class="text-[9px] text-muted-foreground font-mono">
                                              {kfs().length} keyframe
                                              {kfs().length !== 1 ? "s" : ""}
                                            </span>
                                            <button
                                              class={`px-1 text-[9px] rounded ${
                                                nextKeyframe()
                                                  ? "text-muted-foreground hover:text-foreground"
                                                  : "text-muted-foreground/30 cursor-default"
                                              }`}
                                              onClick={goToNextKeyframe}
                                              disabled={!nextKeyframe()}
                                              title="Next keyframe"
                                            >
                                              {"▶"}
                                            </button>
                                            <button
                                              class="ml-auto px-1 text-[9px] text-muted-foreground hover:text-foreground"
                                              onClick={() =>
                                                setShowEasing(!showEasing())
                                              }
                                              title="Easing options"
                                            >
                                              ~
                                            </button>
                                            <button
                                              class="px-1 text-[9px] text-destructive/60 hover:text-destructive"
                                              onClick={() => {
                                                removeAllKeyframes(
                                                  info().track.id,
                                                  info().clip.id,
                                                  fx.id,
                                                  uniform.name,
                                                );
                                                pushAction(
                                                  `Clear keyframes`,
                                                  "◇",
                                                  () => {},
                                                  () =>
                                                    removeAllKeyframes(
                                                      info().track.id,
                                                      info().clip.id,
                                                      fx.id,
                                                      uniform.name,
                                                    ),
                                                );
                                              }}
                                              title="Remove all keyframes"
                                            >
                                              {"\u2715"}
                                            </button>
                                          </div>

                                          {/* Mini keyframe timeline */}
                                          <div
                                            class="relative h-5 bg-secondary/60 rounded border border-border/50 cursor-pointer"
                                            onClick={(e) => {
                                              const rect =
                                                e.currentTarget.getBoundingClientRect();
                                              const pct = Math.max(
                                                0,
                                                Math.min(
                                                  1,
                                                  (e.clientX - rect.left) /
                                                    rect.width,
                                                ),
                                              );
                                              const time =
                                                pct * info().clip.duration;
                                              import("@/stores/project-store").then(
                                                ({ setPlayhead }) => {
                                                  setPlayhead(
                                                    info().clip.startTime +
                                                      time,
                                                  );
                                                },
                                              );
                                            }}
                                          >
                                            {/* Playhead indicator */}
                                            <div
                                              class="absolute top-0 bottom-0 w-px bg-red-500 z-10"
                                              style={{
                                                left: `${Math.max(0, Math.min(100, (clipRelativeTime() / info().clip.duration) * 100))}%`,
                                              }}
                                            />
                                            {/* Keyframe diamonds */}
                                            <For each={kfs()}>
                                              {(kf) => {
                                                const pct = () =>
                                                  (kf.time /
                                                    info().clip.duration) *
                                                  100;
                                                const isAtPlayhead = () =>
                                                  Math.abs(
                                                    kf.time -
                                                      clipRelativeTime(),
                                                  ) < 0.02;
                                                return (
                                                  <div
                                                    class={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border cursor-pointer transition-colors ${
                                                      isAtPlayhead()
                                                        ? "bg-yellow-400 border-yellow-300"
                                                        : "bg-yellow-400/60 border-yellow-500/40 hover:bg-yellow-400"
                                                    }`}
                                                    style={{
                                                      left: `${pct()}%`,
                                                    }}
                                                    title={`${kf.time.toFixed(2)}s = ${kf.value.toFixed(2)} (${kf.easing})`}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      import("@/stores/project-store").then(
                                                        ({ setPlayhead }) => {
                                                          setPlayhead(
                                                            info().clip
                                                              .startTime +
                                                              kf.time,
                                                          );
                                                        },
                                                      );
                                                    }}
                                                  />
                                                );
                                              }}
                                            </For>
                                          </div>

                                          {/* Easing selector (for keyframe at playhead) */}
                                          <Show
                                            when={
                                              showEasing() &&
                                              keyframeAtPlayhead()
                                            }
                                          >
                                            {(kf) => (
                                              <div class="flex flex-wrap gap-1">
                                                {(
                                                  [
                                                    "linear",
                                                    "ease-in",
                                                    "ease-out",
                                                    "ease-in-out",
                                                    "hold",
                                                  ] as KeyframeEasing[]
                                                ).map((easing) => (
                                                  <button
                                                    class={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
                                                      kf().easing === easing
                                                        ? "bg-primary/20 border-primary text-primary"
                                                        : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                                                    }`}
                                                    onClick={() =>
                                                      updateKeyframe(
                                                        info().track.id,
                                                        info().clip.id,
                                                        fx.id,
                                                        uniform.name,
                                                        kf().id,
                                                        { easing },
                                                      )
                                                    }
                                                  >
                                                    {easing}
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                          </Show>
                                        </div>
                                      </Show>
                                    </div>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

export default PropertiesPanel;
