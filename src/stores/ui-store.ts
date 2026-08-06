import { createStore } from "solid-js/store";
import { loadState, createPersistEffect } from "@/lib/persist";

const UI_PREFS_KEY = "ui-prefs";

interface PersistedUIPrefs {
  selectedTool: string;
  theme: "dark" | "light";
}

export type LayoutNodeType = "row" | "col" | "tabs" | "panel";

export interface LayoutNode {
  type: LayoutNodeType;
  id: string;
  children?: LayoutNode[];
  sizes?: number[];
  panelId?: string;
  activeTab?: number;
}

export interface UIState {
  layout: LayoutNode;
  selectedTool: string;
  theme: "dark" | "light";
}

const STORAGE_KEY = "vide-os-layout";

function loadLayout(): LayoutNode | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Corrupt or unreadable layout — fall back to the default.
  }
  return null;
}

export function getDefaultLayout(): LayoutNode {
  return {
    type: "row",
    id: "root",
    sizes: [20, 55, 25],
    children: [
      {
        type: "col",
        id: "left-col",
        sizes: [50, 50],
        children: [
          { type: "panel", id: "left-top", panelId: "file-browser" },
          { type: "panel", id: "left-bottom", panelId: "media-pool" },
        ],
      },
      {
        type: "col",
        id: "center-col",
        sizes: [60, 40],
        children: [
          { type: "panel", id: "center-top", panelId: "preview" },
          { type: "panel", id: "center-bottom", panelId: "timeline" },
        ],
      },
      {
        type: "col",
        id: "right-col",
        sizes: [30, 40, 30],
        children: [
          { type: "panel", id: "right-top", panelId: "tools" },
          {
            type: "tabs",
            id: "right-mid",
            activeTab: 0,
            children: [
              { type: "panel", id: "effects-tab", panelId: "effects" },
              { type: "panel", id: "properties-tab", panelId: "properties" },
            ],
          },
          { type: "panel", id: "right-bottom", panelId: "history" },
        ],
      },
    ],
  };
}

function loadUIPrefs(): Partial<UIState> {
  const saved = loadState<PersistedUIPrefs>(UI_PREFS_KEY);
  return saved
    ? {
        selectedTool: saved.selectedTool ?? "select",
        theme: saved.theme ?? "dark",
      }
    : {};
}

const [uiState, setUIState] = createStore<UIState>({
  layout: loadLayout() || getDefaultLayout(),
  selectedTool: "select",
  theme: "dark",
  ...loadUIPrefs(),
});

/** Call once inside a reactive root to enable auto-save of UI preferences. */
export function initUIPersistence(): void {
  createPersistEffect(UI_PREFS_KEY, (): PersistedUIPrefs => ({
    selectedTool: uiState.selectedTool,
    theme: uiState.theme,
  }));
}

export function saveLayout(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uiState.layout));
  } catch {
    // Quota exceeded or storage disabled — layout is not worth failing over.
  }
}

export function resetLayout(): void {
  const def = getDefaultLayout();
  setUIState("layout", def);
  saveLayout();
}

export function setSelectedTool(tool: string): void {
  setUIState("selectedTool", tool);
}

export function updateLayout(layout: LayoutNode): void {
  setUIState("layout", layout);
  saveLayout();
}

export function updateNodeSizes(nodeId: string, sizes: number[]): void {
  function updateSizes(node: LayoutNode): LayoutNode {
    if (node.id === nodeId) {
      return { ...node, sizes };
    }
    if (node.children) {
      return {
        ...node,
        children: node.children.map(updateSizes),
      };
    }
    return node;
  }
  setUIState("layout", updateSizes(uiState.layout));
  saveLayout();
}

export function setActiveTab(nodeId: string, tabIndex: number): void {
  function update(node: LayoutNode): LayoutNode {
    if (node.id === nodeId) {
      return { ...node, activeTab: tabIndex };
    }
    if (node.children) {
      return { ...node, children: node.children.map(update) };
    }
    return node;
  }
  setUIState("layout", update(uiState.layout));
  saveLayout();
}

export function getActivePanelIds(node?: LayoutNode): string[] {
  const root = node || uiState.layout;
  const ids: string[] = [];
  function walk(n: LayoutNode) {
    if (n.panelId) ids.push(n.panelId);
    if (n.children) n.children.forEach(walk);
  }
  walk(root);
  return ids;
}

export function removePanel(panelId: string): void {
  function remove(node: LayoutNode): LayoutNode | null {
    // If this is the panel to remove, return null
    if (node.type === "panel" && node.panelId === panelId) return null;

    if (!node.children) return node;

    // Filter out removed children
    const newChildren = node.children
      .map(remove)
      .filter((c): c is LayoutNode => c !== null);

    // If no children left, collapse this node
    if (newChildren.length === 0) return null;

    // If only one child left in a split/tabs, promote the child
    if (
      newChildren.length === 1 &&
      (node.type === "row" || node.type === "col" || node.type === "tabs")
    ) {
      return newChildren[0];
    }

    // Redistribute sizes evenly when a child is removed
    const newSizes =
      node.sizes && node.sizes.length !== newChildren.length
        ? newChildren.map(() => 100 / newChildren.length)
        : node.sizes;

    // Clamp activeTab for tabs
    let activeTab = node.activeTab;
    if (
      node.type === "tabs" &&
      activeTab !== undefined &&
      activeTab >= newChildren.length
    ) {
      activeTab = Math.max(0, newChildren.length - 1);
    }

    return { ...node, children: newChildren, sizes: newSizes, activeTab };
  }

  const result = remove(uiState.layout);
  if (result) {
    setUIState("layout", result);
    saveLayout();
  }
}

export function addPanelToLayout(panelId: string): void {
  // Add panel as a new tab in the right column, or append to root
  const layout = JSON.parse(JSON.stringify(uiState.layout)) as LayoutNode;

  // Try to find a tabs node to append to
  function findTabs(node: LayoutNode): LayoutNode | null {
    if (node.type === "tabs") return node;
    if (node.children) {
      for (const child of node.children) {
        const found = findTabs(child);
        if (found) return found;
      }
    }
    return null;
  }

  const newPanel: LayoutNode = {
    type: "panel",
    id: `panel-${panelId}-${Date.now()}`,
    panelId,
  };

  const tabsNode = findTabs(layout);
  if (tabsNode) {
    // Add as a new tab and switch to it
    tabsNode.children = tabsNode.children || [];
    tabsNode.children.push(newPanel);
    tabsNode.activeTab = tabsNode.children.length - 1;
  } else {
    // Wrap the last child of root in a tabs container with the new panel
    if (layout.children && layout.children.length > 0) {
      const lastIdx = layout.children.length - 1;
      const lastChild = layout.children[lastIdx];
      layout.children[lastIdx] = {
        type: "tabs",
        id: `tabs-${Date.now()}`,
        activeTab: 1,
        children: [lastChild, newPanel],
      };
    }
  }

  setUIState("layout", layout);
  saveLayout();
}

export function movePanel(
  panelId: string,
  targetNodeId: string,
  insertIndex?: number,
): void {
  const layout = JSON.parse(JSON.stringify(uiState.layout)) as LayoutNode;

  // 1. Find and detach the panel node from its current location
  let detached: LayoutNode | null = null;

  function detachPanel(node: LayoutNode): LayoutNode | null {
    if (!node.children) return node;

    const idx = node.children.findIndex(
      (c) => c.type === "panel" && c.panelId === panelId,
    );
    if (idx !== -1) {
      detached = node.children[idx];
      node.children.splice(idx, 1);

      // Fix sizes
      if (node.sizes) {
        node.sizes.splice(idx, 1);
        if (node.sizes.length > 0) {
          const total = node.sizes.reduce((a, b) => a + b, 0);
          node.sizes = node.sizes.map((s) => (s / total) * 100);
        }
      }

      // Fix activeTab
      if (node.type === "tabs") {
        if (node.activeTab !== undefined && node.activeTab >= node.children.length) {
          node.activeTab = Math.max(0, node.children.length - 1);
        }
      }

      // If only one child left in a tabs/split, promote it
      if (
        node.children.length === 1 &&
        (node.type === "tabs" || node.type === "row" || node.type === "col")
      ) {
        const only = node.children[0];
        node.type = only.type;
        node.panelId = only.panelId;
        node.children = only.children;
        node.sizes = only.sizes;
        node.activeTab = only.activeTab;
      } else if (node.children.length === 0) {
        return null;
      }

      return node;
    }

    // Recurse
    for (let i = 0; i < node.children.length; i++) {
      const result = detachPanel(node.children[i]);
      if (detached) {
        if (result === null) {
          // Child collapsed, remove it
          node.children.splice(i, 1);
          if (node.sizes) {
            node.sizes.splice(i, 1);
            if (node.sizes.length > 0) {
              const total = node.sizes.reduce((a, b) => a + b, 0);
              node.sizes = node.sizes.map((s) => (s / total) * 100);
            }
          }
          // Promote if only one child left
          if (
            node.children.length === 1 &&
            (node.type === "tabs" || node.type === "row" || node.type === "col")
          ) {
            const only = node.children[0];
            node.type = only.type;
            node.panelId = only.panelId;
            node.children = only.children;
            node.sizes = only.sizes;
            node.activeTab = only.activeTab;
          }
        }
        return node;
      }
    }

    return node;
  }

  detachPanel(layout);
  if (!detached) return;

  // 2. Insert into target
  function insertInto(node: LayoutNode): boolean {
    if (node.id === targetNodeId) {
      if (node.type === "tabs") {
        // Insert into existing tabs
        node.children = node.children || [];
        const idx =
          insertIndex !== undefined
            ? Math.min(insertIndex, node.children.length)
            : node.children.length;
        node.children.splice(idx, 0, detached!);
        node.activeTab = idx;
        return true;
      } else if (node.type === "panel") {
        // Wrap this panel + the dragged panel in a new tabs node
        const existingPanel: LayoutNode = {
          type: "panel",
          id: node.id + "-wrapped",
          panelId: node.panelId,
        };
        node.type = "tabs";
        node.activeTab = 1;
        node.panelId = undefined;
        node.children = [existingPanel, detached!];
        return true;
      }
    }
    if (node.children) {
      for (const child of node.children) {
        if (insertInto(child)) return true;
      }
    }
    return false;
  }

  if (insertInto(layout)) {
    setUIState("layout", layout);
    saveLayout();
  }
}

export { uiState, setUIState };
