import { Component, onMount, onCleanup, createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { VePanelLayout } from "./web-components/ve-panel-layout";
import {
  uiState,
  updateLayout,
  resetLayout,
  getDefaultLayout,
  removePanel,
  addPanelToLayout,
  getActivePanelIds,
  movePanel,
  initUIPersistence,
} from "./stores/ui-store";
import {
  projectState,
  setProjectState,
  initProjectPersistence,
} from "./stores/project-store";
import { undo, redo } from "./stores/history-store";
import {
  timelineState,
  clearSelection,
  selectAllClips,
  initTimelinePersistence,
} from "./stores/timeline-store";
import { restoreMedia } from "./stores/media-store";
import { registerPanel, type PanelDefinition } from "./web-components/registry";

import FileBrowserPanel from "./panels/FileBrowserPanel";
import MediaPoolPanel from "./panels/MediaPoolPanel";
import TimelinePanel from "./panels/TimelinePanel";
import PreviewPanel from "./panels/PreviewPanel";
import ToolsPanel from "./panels/ToolsPanel";
import EffectsPanel from "./panels/EffectsPanel";
import PropertiesPanel from "./panels/PropertiesPanel";
import HistoryPanel from "./panels/HistoryPanel";
import ExportDialog from "./panels/ExportDialog";

// Helper: mount a SolidJS component into a <ve-panel> web component
function createPanelElement(
  title: string,
  SolidComponent: Component,
): HTMLElement {
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

// Register all built-in panels
const builtInPanels: PanelDefinition[] = [
  {
    id: "file-browser",
    name: "File Browser",
    icon: "📁",
    category: "media",
    component: () => createPanelElement("File Browser", FileBrowserPanel),
    defaultPosition: { area: "left", order: 0 },
  },
  {
    id: "media-pool",
    name: "Media Pool",
    icon: "🎞️",
    category: "media",
    component: () => createPanelElement("Media Pool", MediaPoolPanel),
    defaultPosition: { area: "left", order: 1 },
  },
  {
    id: "timeline",
    name: "Timeline",
    icon: "🎬",
    category: "editing",
    component: () => createPanelElement("Timeline", TimelinePanel),
    defaultPosition: { area: "center-bottom" },
  },
  {
    id: "preview",
    name: "Preview",
    icon: "▶",
    category: "editing",
    component: () => createPanelElement("Preview", PreviewPanel),
    defaultPosition: { area: "center-top" },
  },
  {
    id: "tools",
    name: "Tools",
    icon: "🔧",
    category: "editing",
    component: () => createPanelElement("Tools", ToolsPanel),
    defaultPosition: { area: "right", order: 0 },
  },
  {
    id: "effects",
    name: "Effects",
    icon: "✨",
    category: "effects",
    component: () => createPanelElement("Effects", EffectsPanel),
    defaultPosition: { area: "right", order: 1 },
  },
  {
    id: "properties",
    name: "Properties",
    icon: "⚙",
    category: "utility",
    component: () => createPanelElement("Properties", PropertiesPanel),
    defaultPosition: { area: "right", order: 2 },
  },
  {
    id: "history",
    name: "History",
    icon: "🕐",
    category: "utility",
    component: () => createPanelElement("History", HistoryPanel),
    defaultPosition: { area: "right", order: 3 },
  },
];

const App: Component = () => {
  let layoutRef: HTMLElement | undefined;
  const [menuOpen, setMenuOpen] = createSignal<string | null>(null);
  const [exportOpen, setExportOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  const [aboutOpen, setAboutOpen] = createSignal(false);

  onMount(() => {
    // Initialize persistent state auto-save
    initProjectPersistence();
    initTimelinePersistence();
    initUIPersistence();

    // Restore media entries from persisted file handles
    restoreMedia();

    // Register built-in panels
    builtInPanels.forEach((p) => registerPanel(p));

    // Set up the layout web component
    const layoutEl = layoutRef as unknown as VePanelLayout;
    if (!layoutEl) return;

    // Register panel factories
    builtInPanels.forEach((p) => {
      layoutEl.registerPanelFactory(p.id, p.component);
    });

    // Set initial layout from store
    layoutEl.setLayout(JSON.parse(JSON.stringify(uiState.layout)));

    // Listen for layout changes from the web component
    layoutEl.addEventListener("layout-change", ((e: CustomEvent) => {
      updateLayout(e.detail.layout);
    }) as EventListener);

    // Listen for panel close events (from tab close buttons and ve-panel close buttons)
    layoutEl.addEventListener("panel-close", ((e: CustomEvent) => {
      const panelId = e.detail?.panelId;
      if (panelId) {
        removePanel(panelId);
        layoutEl.setLayout(JSON.parse(JSON.stringify(uiState.layout)));
      }
    }) as EventListener);

    // Listen for panel move events (tab drag-and-drop between panes)
    layoutEl.addEventListener("panel-move", ((e: CustomEvent) => {
      const { panelId, targetNodeId, insertIndex } = e.detail;
      if (panelId && targetNodeId) {
        movePanel(panelId, targetNodeId, insertIndex);
        layoutEl.setLayout(JSON.parse(JSON.stringify(uiState.layout)));
      }
    }) as EventListener);

    // Close menus on outside click
    const closeMenus = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".menu-bar")) setMenuOpen(null);
    };
    window.addEventListener("click", closeMenus);
    onCleanup(() => window.removeEventListener("click", closeMenus));
  });

  // ── Menu actions ────────────────────────────────────────────────

  const handleResetLayout = () => {
    resetLayout();
    const layoutEl = layoutRef as unknown as VePanelLayout;
    if (layoutEl) {
      layoutEl.setLayout(JSON.parse(JSON.stringify(getDefaultLayout())));
    }
  };

  const handleNewProject = () => {
    if (!confirm("Create a new project? Unsaved changes will be lost.")) return;
    location.reload();
  };

  const handleSaveProject = () => {
    const data = {
      name: projectState.name,
      tracks: JSON.parse(JSON.stringify(projectState.tracks)),
      duration: projectState.duration,
      fps: projectState.fps,
      width: projectState.width,
      height: projectState.height,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectState.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.videos.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenProject = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.videos.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.tracks) {
          setProjectState("name", data.name || "Untitled Project");
          setProjectState("tracks", data.tracks);
          setProjectState("duration", data.duration || 300);
          setProjectState("fps", data.fps || 30);
          setProjectState("width", data.width || 1920);
          setProjectState("height", data.height || 1080);
          setProjectState("playheadPosition", 0);
          setProjectState("isPlaying", false);
        }
      } catch {
        alert("Failed to load project file.");
      }
    };
    input.click();
  };

  const handleDeleteSelected = () => {
    // Dispatch a synthetic keyboard event to trigger the timeline's delete handler
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
  };

  const menuItems: Record<
    string,
    {
      label: string;
      shortcut?: string;
      action?: () => void;
      separator?: boolean;
      icon?: string;
      checked?: boolean;
    }[]
  > = {
    File: [
      { label: "New Project", shortcut: "", action: handleNewProject },
      { label: "Open Project...", shortcut: "⌘O", action: handleOpenProject },
      { label: "Save Project", shortcut: "⌘S", action: handleSaveProject },
      { label: "", separator: true },
      { label: "Export...", shortcut: "⌘E", action: () => setExportOpen(true) },
    ],
    Edit: [
      { label: "Undo", shortcut: "⌘Z", action: () => undo() },
      { label: "Redo", shortcut: "⇧⌘Z", action: () => redo() },
      { label: "", separator: true },
      { label: "Select All", shortcut: "⌘A", action: () => selectAllClips() },
      { label: "Deselect All", shortcut: "", action: () => clearSelection() },
      { label: "Delete", shortcut: "⌫", action: handleDeleteSelected },
    ],
    View: [
      { label: "Reset Layout", action: handleResetLayout },
      { label: "", separator: true },
      ...builtInPanels.map((p) => ({
        label: p.name,
        icon: p.icon,
        action: () => {
          const layoutEl = layoutRef as unknown as VePanelLayout;
          const active = getActivePanelIds();
          if (active.includes(p.id)) {
            removePanel(p.id);
          } else {
            addPanelToLayout(p.id);
          }
          if (layoutEl) {
            layoutEl.setLayout(JSON.parse(JSON.stringify(uiState.layout)));
          }
        },
        get checked() {
          return getActivePanelIds().includes(p.id);
        },
      })),
    ],
    Help: [
      {
        label: "Keyboard Shortcuts",
        shortcut: "?",
        action: () => setShortcutsOpen(true),
      },
      { label: "About VideOS", action: () => setAboutOpen(true) },
    ],
  };

  return (
    <div class="h-full flex flex-col bg-background text-foreground">
      {/* Menu Bar */}
      <div class="menu-bar flex items-center h-8 px-2 bg-panel-header border-b border-border flex-shrink-0 gap-0.5">
        <span class="text-xs font-bold text-primary mr-3 tracking-wide">
          VideOS
        </span>
        {Object.entries(menuItems).map(([menu, items]) => (
          <div class="relative">
            <button
              class={`px-2 py-1 text-xs rounded transition-colors ${
                menuOpen() === menu
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(menuOpen() === menu ? null : menu);
              }}
              onMouseEnter={() => {
                if (menuOpen() !== null) setMenuOpen(menu);
              }}
            >
              {menu}
            </button>
            {menuOpen() === menu && (
              <div class="absolute top-full left-0 mt-0.5 min-w-[200px] bg-popover border border-border rounded-md shadow-lg py-1 z-50">
                {items.map((item) =>
                  item.separator ? (
                    <div class="my-1 border-t border-border" />
                  ) : (
                    <button
                      class="w-full flex items-center justify-between px-3 py-1.5 text-xs text-popover-foreground hover:bg-accent transition-colors"
                      onClick={() => {
                        item.action?.();
                        setMenuOpen(null);
                      }}
                    >
                      <span class="flex items-center gap-2">
                        {"checked" in item && (
                          <span class="w-4 text-center text-[10px]">
                            {item.checked ? "✓" : ""}
                          </span>
                        )}
                        {item.icon && (
                          <span class="text-[10px]">{item.icon}</span>
                        )}
                        <span>{item.label}</span>
                      </span>
                      {item.shortcut && (
                        <span class="text-[10px] text-muted-foreground ml-4">
                          {item.shortcut}
                        </span>
                      )}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        <div class="flex-1" />
        <span class="text-[10px] text-muted-foreground">
          {uiState.selectedTool.toUpperCase()}
        </span>
      </div>

      {/* Panel Layout */}
      <div class="flex-1 min-h-0">
        {/* @ts-ignore - custom element */}
        <ve-panel-layout ref={layoutRef} />
      </div>

      {/* Status Bar */}
      <div class="flex items-center h-6 px-3 bg-panel-header border-t border-border flex-shrink-0 text-[10px] text-muted-foreground gap-4">
        <span>Ready</span>
        <span>
          {projectState.width}×{projectState.height}
        </span>
        <span>{projectState.fps} fps</span>
        <div class="flex-1" />
        <span>Chromium Only</span>
      </div>

      {/* Export Dialog */}
      <ExportDialog open={exportOpen()} onClose={() => setExportOpen(false)} />

      {/* Keyboard Shortcuts Overlay */}
      <Show when={shortcutsOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            class="bg-card border border-border rounded-lg shadow-2xl w-[520px] max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 class="text-sm font-semibold">Keyboard Shortcuts</h2>
              <button
                class="text-muted-foreground hover:text-foreground"
                onClick={() => setShortcutsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div class="px-5 py-4 space-y-3 text-xs">
              {[
                [
                  "Transport",
                  [
                    ["Space", "Play / Pause"],
                    ["J", "Rewind 5s"],
                    ["K", "Play / Pause"],
                    ["L", "Forward 5s"],
                    ["Home", "Go to start"],
                    ["End", "Go to end"],
                  ],
                ],
                [
                  "Playhead",
                  [
                    ["← →", "Step 1 frame"],
                    ["Shift + ← →", "Nudge clips 1s"],
                  ],
                ],
                [
                  "Editing",
                  [
                    ["Delete / ⌫", "Delete selected"],
                    ["⌘A", "Select all"],
                    ["⌘Z", "Undo"],
                    ["⇧⌘Z", "Redo"],
                    ["S", "Toggle snap"],
                  ],
                ],
                [
                  "Tools",
                  [
                    ["V", "Select"],
                    ["C", "Razor"],
                    ["T", "Trim"],
                    ["Y", "Slip"],
                    ["U", "Slide"],
                    ["H", "Hand"],
                  ],
                ],
                [
                  "Zoom",
                  [
                    ["⌘+", "Zoom in"],
                    ["⌘−", "Zoom out"],
                  ],
                ],
              ].map(([section, shortcuts]) => (
                <div>
                  <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                    {section as string}
                  </div>
                  <div class="grid grid-cols-2 gap-y-1">
                    {(shortcuts as string[][]).map(([key, desc]) => (
                      <>
                        <span class="font-mono text-muted-foreground">
                          {key}
                        </span>
                        <span class="text-foreground">{desc}</span>
                      </>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Show>

      {/* About Overlay */}
      <Show when={aboutOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setAboutOpen(false)}
        >
          <div
            class="bg-card border border-border rounded-lg shadow-2xl w-[360px] text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="px-6 py-8 space-y-3">
              <div class="text-2xl font-bold text-primary">VideOS</div>
              <div class="text-xs text-muted-foreground">
                Browser-Based Video Editor
              </div>
              <div class="text-[10px] text-muted-foreground/60 space-y-1">
                <div>Built with SolidJS + WebGL2 + Web Components</div>
                <div>File System Access API · MediaRecorder API</div>
                <div>Chromium-based browsers only</div>
              </div>
              <button
                class="mt-4 px-4 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setAboutOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default App;
