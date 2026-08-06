import { Component, For, Show, createSignal } from "solid-js";
import { EFFECT_DEFINITIONS } from "@/renderer/effects-pipeline";
import { timelineState } from "@/stores/timeline-store";
import { projectState, addEffectToClip } from "@/stores/project-store";
import { pushAction } from "@/stores/history-store";

const effectIcons: Record<string, string> = {
  brightness_contrast: "☀",
  saturation: "�",
  hue_rotate: "🌈",
  chroma_key: "🟩",
  gaussian_blur: "💨",
  sharpen: "🔪",
  vignette: "⬛",
  film_grain: "📺",
};

const EffectsPanel: Component = () => {
  const [search, setSearch] = createSignal("");
  const [selectedCategory, setSelectedCategory] = createSignal("All");

  const categories = () => {
    const cats = new Set(EFFECT_DEFINITIONS.map((e) => e.category));
    return ["All", ...Array.from(cats)];
  };

  const filteredEffects = () => {
    return EFFECT_DEFINITIONS.filter((e) => {
      const matchesSearch = e.name
        .toLowerCase()
        .includes(search().toLowerCase());
      const matchesCategory =
        selectedCategory() === "All" || e.category === selectedCategory();
      return matchesSearch && matchesCategory;
    });
  };

  const hasSelection = () => timelineState.selectedClips.length > 0;

  const applyEffectToSelection = (definitionId: string) => {
    if (!hasSelection()) return;

    const def = EFFECT_DEFINITIONS.find((d) => d.id === definitionId);
    if (!def) return;

    // Build default values from definition
    const defaults: Record<string, number | number[]> = {};
    for (const u of def.uniforms) {
      defaults[u.name] = u.default;
    }

    for (const ref of timelineState.selectedClips) {
      const effect = addEffectToClip(
        ref.trackId,
        ref.clipId,
        definitionId,
        defaults,
      );
      pushAction(
        `Add ${def.name}`,
        effectIcons[definitionId] || "✨",
        () => {
          import("@/stores/project-store").then(({ removeEffectFromClip }) => {
            removeEffectFromClip(ref.trackId, ref.clipId, effect.id);
          });
        },
        () => addEffectToClip(ref.trackId, ref.clipId, definitionId, defaults),
      );
    }
  };

  return (
    <div class="h-full flex flex-col text-sm">
      <div class="p-2 border-b border-border">
        <input
          type="text"
          placeholder="Search effects..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full px-2 py-1 text-xs bg-input border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div class="flex gap-1 px-2 py-1.5 border-b border-border overflow-x-auto">
        <For each={categories()}>
          {(cat) => (
            <button
              onClick={() => setSelectedCategory(cat)}
              class={`px-2 py-0.5 text-[10px] rounded-full whitespace-nowrap transition-colors ${
                selectedCategory() === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat}
            </button>
          )}
        </For>
      </div>
      <Show when={!hasSelection()}>
        <div class="px-3 py-1.5 text-[10px] text-muted-foreground/60 bg-secondary/30 border-b border-border">
          Select a clip to apply effects
        </div>
      </Show>
      <div class="flex-1 overflow-auto">
        <For each={filteredEffects()}>
          {(effect) => (
            <div
              class={`flex items-center gap-2 px-3 py-2 border-b border-border/50 transition-colors ${
                hasSelection()
                  ? "hover:bg-accent cursor-pointer"
                  : "opacity-50 cursor-default"
              }`}
              onDblClick={() => applyEffectToSelection(effect.id)}
              onClick={() => {
                // Single click applies if selection exists
                if (hasSelection()) applyEffectToSelection(effect.id);
              }}
              title={
                hasSelection()
                  ? `Click to add ${effect.name} to selected clip(s)`
                  : "Select a clip first"
              }
            >
              <span class="text-base">{effectIcons[effect.id] || "✨"}</span>
              <div class="flex flex-col">
                <span class="text-xs font-medium text-foreground">
                  {effect.name}
                </span>
                <span class="text-[10px] text-muted-foreground">
                  {effect.category}
                </span>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default EffectsPanel;
