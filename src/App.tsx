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
  doc,
  loadDocument,
  newProject,
  initProjectPersistence,
} from "./stores/project-store";
import { frameRateToNumber } from "@/lib/timecode";
import {
  packBundle,
  mediaTableFromDoc,
  readProjectFile,
  projectFileName,
} from "./model/io";
import { initTimelinePersistence } from "./stores/timeline-store";
import { initTransport } from "./playback/transport";
import { hasMediaProblems, mediaProblems } from "./stores/media-problems";
import { restoreMedia } from "./stores/media-store";
import { registerPanel, type PanelDefinition } from "./web-components/registry";
import {
  commands as builtInCommands,
  registerCommands,
  clearCommands,
  installShortcuts,
  runCommand,
  isEnabled,
  getCommand,
  formatChord,
} from "./commands";

import FileBrowserPanel from "./panels/FileBrowserPanel";
import MediaPoolPanel from "./panels/MediaPoolPanel";
import TimelinePanel from "./panels/TimelinePanel";
import PreviewPanel from "./panels/PreviewPanel";
import ToolsPanel from "./panels/ToolsPanel";
import EffectsPanel from "./panels/EffectsPanel";
import PropertiesPanel from "./panels/properties/PropertiesPanel";
import HistoryPanel from "./panels/HistoryPanel";
import MixerPanel from "./panels/MixerPanel";
import ExportDialog from "./panels/ExportDialog";
import RelinkDialog from "./panels/RelinkDialog";

// Helper: mount a SolidJS component into a <ve-panel> web component
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
    id: "mixer",
    name: "Mixer",
    icon: "🎚",
    category: "utility",
    component: () => createPanelElement("Mixer", MixerPanel),
    defaultPosition: { area: "right", order: 3 },
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
  const [openWarnings, setOpenWarnings] = createSignal<string[]>([]);
  const [relinkOpen, setRelinkOpen] = createSignal(false);

  onMount(() => {
    // Initialize persistent state auto-save
    initProjectPersistence();
    initTimelinePersistence();
    initUIPersistence();
    initTransport();

    // Restore media entries from persisted file handles
    void restoreMedia();

    // Register built-in panels
    builtInPanels.forEach((p) => registerPanel(p));

    // Commands: the timeline-level ones are static, the file-level ones close
    // over App's dialog signals. Clearing first keeps a remount idempotent.
    clearCommands();
    registerCommands([
      ...builtInCommands,
      {
        id: "file.new",
        label: "New Project",
        category: "File",
        run: handleNewProject,
      },
      {
        id: "file.open",
        label: "Open Project",
        shortcut: "Mod+O",
        category: "File",
        run: () => void handleOpenProject(),
      },
      {
        id: "file.save",
        label: "Save Project",
        shortcut: "Mod+S",
        category: "File",
        run: handleSaveProject,
      },
      {
        id: "file.export",
        label: "Export",
        shortcut: "Mod+E",
        category: "File",
        run: () => setExportOpen(true),
      },
      {
        id: "view.resetLayout",
        label: "Reset Layout",
        category: "View",
        run: handleResetLayout,
      },
    ]);
    onCleanup(installShortcuts());

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
    // Replaces the document rather than reloading the page, so panel layout
    // and open folders survive.
    newProject();
  };

  const handleSaveProject = () => {
    // Writes a `.videos` bundle: the document plus a media table recording
    // where each asset lives, so the project can be reopened elsewhere. The
    // old format saved no media list at all.
    const document_ = doc();
    const bytes = packBundle({
      doc: document_,
      media: mediaTableFromDoc(document_),
    });

    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = projectFileName(document_.name);
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenProject = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".videos,.json";
    input.onchange = () =>
      void (async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          // Parses, migrates from any older format, and validates against the
          // document invariants before anything is swapped in.
          const { doc: loaded, warnings } = readProjectFile(bytes);
          loadDocument(loaded);
          if (warnings.length > 0) setOpenWarnings(warnings);
        } catch (error) {
          alert(
            error instanceof Error
              ? `Could not open the project:\n\n${error.message}`
              : "Could not open the project.",
          );
        }
      })();
    input.click();
  };

  /**
   * Builds a menu entry from a registered command, so the label, shortcut
   * glyph, and enabled state all come from the single command definition
   * rather than being retyped alongside a second implementation.
   */
  const fromCommand = (id: string, labelOverride?: string) => ({
    // Every field is a getter: this array is built in the component body,
    // which runs before onMount registers the commands. Reading eagerly gave
    // menus that displayed raw command ids.
    get label() {
      return labelOverride ?? getCommand(id)?.label ?? id;
    },
    get shortcut() {
      const shortcut = getCommand(id)?.shortcut;
      return shortcut ? formatChord(shortcut) : "";
    },
    get disabled() {
      return !isEnabled(id);
    },
    action: () => runCommand(id),
  });

  const menuItems: Record<
    string,
    {
      label: string;
      shortcut?: string;
      action?: () => void;
      separator?: boolean;
      icon?: string;
      checked?: boolean;
      disabled?: boolean;
    }[]
  > = {
    File: [
      fromCommand("file.new", "New Project"),
      fromCommand("file.open", "Open Project..."),
      fromCommand("file.save", "Save Project"),
      { label: "", separator: true },
      fromCommand("file.export", "Export..."),
    ],
    Edit: [
      fromCommand("edit.undo"),
      fromCommand("edit.redo"),
      { label: "", separator: true },
      fromCommand("edit.cut"),
      fromCommand("edit.copy"),
      fromCommand("edit.paste"),
      fromCommand("edit.duplicate"),
      { label: "", separator: true },
      fromCommand("edit.selectAll"),
      fromCommand("edit.deselectAll"),
      fromCommand("edit.delete"),
      fromCommand("edit.rippleDelete"),
    ],
    View: [
      fromCommand("view.resetLayout"),
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
        <span class="text-xs font-bold text-primary mr-3 tracking-wide">VideOS</span>
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
                      disabled={item.disabled}
                      class="w-full flex items-center justify-between px-3 py-1.5 text-xs text-popover-foreground transition-colors enabled:hover:bg-accent disabled:opacity-40 disabled:cursor-default"
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
                        {item.icon && <span class="text-[10px]">{item.icon}</span>}
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

      {/*
        Media problems are surfaced as a bar rather than left to be discovered
        as a black clip. The re-grant it offers has to happen inside a click:
        the browser refuses a permission request outside a user gesture, which
        is why nothing attempts one on startup.
      */}
      <Show when={hasMediaProblems()}>
        <div class="flex items-center gap-2 px-3 py-1.5 bg-amber-500/15 border-b border-amber-500/40 text-[11px] shrink-0">
          <span>⚠</span>
          <span class="text-foreground">
            {mediaProblems().length} media file
            {mediaProblems().length === 1 ? "" : "s"} cannot be used.
          </span>
          <button
            class="px-2 py-0.5 rounded bg-amber-500 text-black text-[10px] font-medium hover:bg-amber-400"
            onClick={() => setRelinkOpen(true)}
          >
            Reconnect media
          </button>
        </div>
      </Show>

      {/* Panel Layout */}
      <div class="flex-1 min-h-0">
        {/* @ts-expect-error - custom element */}
        <ve-panel-layout ref={layoutRef} />
      </div>

      {/* Status Bar */}
      <div class="flex items-center h-6 px-3 bg-panel-header border-t border-border flex-shrink-0 text-[10px] text-muted-foreground gap-4">
        <span>Ready</span>
        <span>
          {doc().sequence.width}×{doc().sequence.height}
        </span>
        <span>{frameRateToNumber(doc().sequence.frameRate).toFixed(2)} fps</span>
        <div class="flex-1" />
      </div>

      {/* Export Dialog */}
      <ExportDialog open={exportOpen()} onClose={() => setExportOpen(false)} />
      <RelinkDialog open={relinkOpen()} onClose={() => setRelinkOpen(false)} />

      {/*
        Notes from opening an older project — offline media, trimmed overlaps,
        a reinterpreted frame rate. Shown rather than swallowed, because most
        of them mean the user has something to fix.
      */}
      <Show when={openWarnings().length > 0}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpenWarnings([])}
        >
          <div
            class="bg-card border border-border rounded-lg shadow-2xl w-[480px] max-h-[70vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 class="text-sm font-semibold">Project opened with changes</h2>
              <button
                class="text-muted-foreground hover:text-foreground"
                onClick={() => setOpenWarnings([])}
              >
                ✕
              </button>
            </div>
            <ul class="px-5 py-4 space-y-2 text-xs text-muted-foreground list-disc list-inside">
              {openWarnings().map((warning) => (
                <li>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      </Show>

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
                        <span class="font-mono text-muted-foreground">{key}</span>
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
