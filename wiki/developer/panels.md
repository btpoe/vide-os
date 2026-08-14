# Panels API

How to add a dockable panel to VideOS.

---

## The interface

```ts
// src/web-components/registry.ts

export interface LayoutPosition {
  area: "left" | "center-top" | "center-bottom" | "right";
  order?: number;
}

export interface PanelDefinition {
  /** Unique. Also the key used in saved layouts, so do not change it casually. */
  id: string;
  /** Shown on the tab and in the View menu. */
  name: string;
  /** A single emoji or character. */
  icon: string;
  category: "media" | "editing" | "effects" | "utility" | "custom";
  /** Builds the panel's DOM. Called once per instantiation. */
  component: () => HTMLElement;
  /** Where it lands when added to a layout that does not already place it. */
  defaultPosition?: LayoutPosition;
}

export function registerPanel(definition: PanelDefinition): void;
export function unregisterPanel(id: string): void;
export function getPanels(): PanelDefinition[];
export function getPanelById(id: string): PanelDefinition | undefined;
```

`registerPanel` is idempotent — registering an id that already exists is a
no-op rather than an error, so a hot reload does not duplicate panels.

The `custom` category exists specifically for third-party panels.

---

## Writing one

A panel is a `<ve-panel>` custom element with something rendered inside it.
`component()` returns that element. The built-in helper in `App.tsx` shows the
pattern:

```tsx
import { render } from "solid-js/web";
import type { Component } from "solid-js";

function createPanelElement(title: string, SolidComponent: Component): HTMLElement {
  const panel = document.createElement("ve-panel");
  panel.setAttribute("title", title);

  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.overflow = "auto";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.minHeight = "0";
  panel.appendChild(container);

  render(() => <SolidComponent />, container);
  return panel;
}
```

Note it returns a plain `HTMLElement`. **Solid is a convenience, not a
requirement** — a panel that renders with anything, or with nothing at all, is
equally valid. That is the whole reason the boundary is a DOM element rather
than a component type.

### A complete example

```tsx
import { Component, createMemo } from "solid-js";
import { registerPanel } from "@/web-components/registry";
import { doc } from "@/stores/project-store";
import { framesToTimecode } from "@/lib/timecode";
import { contentEndFrame } from "@/model/doc";

const StatsPanel: Component = () => {
  const clipCount = createMemo(() =>
    doc().tracks.reduce((n, track) => n + track.clips.length, 0),
  );

  return (
    <div class="h-full p-3 text-xs space-y-1">
      <div>
        {clipCount()} clips on {doc().tracks.length} tracks
      </div>
      <div>{doc().assets.length} assets</div>
      <div>
        Runs to {framesToTimecode(contentEndFrame(doc()), doc().sequence.frameRate)}
      </div>
    </div>
  );
};

registerPanel({
  id: "stats",
  name: "Stats",
  icon: "📊",
  category: "custom",
  component: () => createPanelElement("Stats", StatsPanel),
  defaultPosition: { area: "right", order: 6 },
});
```

Register it alongside the built-ins in `App.tsx`'s `onMount`, and register the
same id as a factory with the layout element:

```ts
builtInPanels.forEach((p) => registerPanel(p));
builtInPanels.forEach((p) => layoutEl.registerPanelFactory(p.id, p.component));
```

Both are needed: the first makes it appear in the View menu, the second lets the
layout build it.

---

## Panel conventions

Follow these and your panel will feel like the rest of the app.

### Fill the height, scroll inside

```tsx
<div class="h-full flex flex-col text-sm">
  <div class="p-2 border-b border-border">{/* fixed header */}</div>
  <div class="flex-1 overflow-auto">{/* scrolling body */}</div>
</div>
```

The panel body is `overflow: hidden`, so a panel that does not manage its own
scrolling will clip.

### Have a real empty state

Every built-in panel says what to do when it has nothing to show, rather than
rendering blank:

```tsx
<Show
  when={items().length > 0}
  fallback={
    <div
      class="flex-1 flex flex-col items-center justify-center
              text-muted-foreground text-xs gap-2 p-4 text-center"
    >
      <span class="text-2xl">📊</span>
      <span>Nothing to show yet</span>
      <span class="text-[10px]">Add a clip to the timeline.</span>
    </div>
  }
>
  {/* … */}
</Show>
```

### Use the theme tokens

`bg-card`, `bg-panel-header`, `bg-secondary`, `bg-input`, `border-border`,
`text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`,
`bg-accent` for hover. Do not hard-code colours; the token set is what makes a
future light theme possible.

Type scale in panels is small: `text-xs` for content, `text-[10px]` for labels
and metadata, `text-[9px]` for dense readouts.

### Iterate stable ids, not objects

This one has bitten the project twice, in two different panels:

```tsx
// Wrong — the row is rebuilt on every keystroke and the caret is lost.
<For each={markers()}>{(marker) => <Row marker={marker} />}</For>;

// Right.
const ids = createMemo(() => markers().map((m) => m.id));
<For each={ids()}>
  {(id) => <Show when={byId(id)}>{(m) => <Row marker={m()} />}</Show>}
</For>;
```

Structural sharing means every edit produces a **new object**, and Solid's `For`
compares by reference. Iterating objects rebuilds the DOM node — taking any
focused input's caret with it.

### Never do work in the render body

Requesting a thumbnail, kicking off a decode, or writing to a store during
render will re-fire on every reconcile. Use `createEffect`.

### Dispatch commands, do not reimplement them

If your panel needs a button for something the app already does, use
`runCommand("edit.delete")` rather than calling the underlying function. That
keeps the enabled-state predicate and the undo label in one place.

---

## Talking to the app

Panels read reactive state from the stores and write through the documented
mutators.

| Import                         | Gives you                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| `@/stores/project-store`       | `doc()`, `playheadFrame()`, `applyEdit`, and every document mutator |
| `@/stores/timeline-store`      | `timelineState.selectedClips`, `selectClip`, `clearSelection`       |
| `@/stores/timeline-view-store` | zoom, scroll, `revealFrame`, track heights                          |
| `@/stores/media-store`         | `mediaState.entries`, `importFileHandle`                            |
| `@/stores/source-store`        | the source monitor's asset, marks and position                      |
| `@/stores/history-store`       | `undo`, `redo`, `historyState()`                                    |
| `@/stores/ui-store`            | `uiState.selectedTool`, layout, the debug HUD flag                  |
| `@/playback/transport`         | `isPlaying()`, `play`, `pause`, `seekToFrame`, `shuttle`            |
| `@/commands`                   | `runCommand`, `isEnabled`, `getCommand`, `registerCommands`         |
| `@/media/engine`               | `mediaEngine.tryGet` / `getExact` for decoded frames                |

Details in [The Document](document.md).

---

## The layout element

`<ve-panel-layout>` owns the tree, the splitters, the tabs and the drag-and-drop.

```ts
layoutEl.registerPanelFactory(panelId: string, factory: () => HTMLElement): void
layoutEl.setLayout(layout: LayoutNode): void
layoutEl.getLayout(): LayoutNode | null
```

It emits three events:

| Event           | `detail`                                 | Meaning                     |
| --------------- | ---------------------------------------- | --------------------------- |
| `layout-change` | `{ layout }`                             | Splitter drag, tab change   |
| `panel-close`   | `{ panelId }`                            | A tab's ✕ was clicked       |
| `panel-move`    | `{ panelId, targetNodeId, insertIndex }` | A tab was dragged elsewhere |

`App.tsx` listens for all three and writes the result back through the UI store,
which persists to `localStorage`.

A `LayoutNode` is a tree of `row`, `col`, `tabs` and `panel` nodes — see
[`src/stores/ui-store.ts`](../../src/stores/ui-store.ts) for the type and the
default layout.

---

## Limitations to know about

- **Panels live in shadow DOM.** If you dispatch synthetic events in a test,
  they need `composed: true` or they will never cross the boundary and your
  handler will silently not run.
- **The docking layout is keyboard-navigable; your panel's contents are your
  responsibility.** Tab bars are `tablist`s with a roving tabindex, splitters are
  `separator`s, and `F6` cycles between panel regions — but nothing audits what
  is inside them. Give controls accessible names and a sensible focus order.

  `F6` finds the region a panel's contents are in by walking up from the focused
  element, so it keeps working inside your panel without you doing anything. It
  is the one layout key that is a command in the registry rather than a handler
  on the element, because it has to work from outside the layout too; the entry
  point is `focusAdjacentPanel` in
  [`src/web-components/panel-focus.ts`](../../src/web-components/panel-focus.ts),
  kept apart from the element module so the registry stays loadable without a
  DOM.

- **Panel state is not persisted** beyond its position in the layout. If your
  panel has preferences, persist them yourself with `@/lib/persist`.
- **Removing a panel id that a saved layout references** leaves a dangling
  reference. Bump your panel id only when you mean to.

Source: [`src/web-components/registry.ts`](../../src/web-components/registry.ts),
[`src/web-components/ve-panel.ts`](../../src/web-components/ve-panel.ts),
[`src/web-components/ve-panel-layout.ts`](../../src/web-components/ve-panel-layout.ts),
[`src/App.tsx`](../../src/App.tsx).
