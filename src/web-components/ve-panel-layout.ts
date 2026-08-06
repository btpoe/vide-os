export interface LayoutNode {
  type: "row" | "col" | "tabs" | "panel";
  id: string;
  children?: LayoutNode[];
  sizes?: number[];
  panelId?: string;
  activeTab?: number;
}

const DIVIDER_SIZE = 4;
const MIN_PANEL_SIZE = 5; // percent

const layoutStyles = `
  :host {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .layout-row, .layout-col {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }

  .layout-row {
    flex-direction: row;
  }

  .layout-col {
    flex-direction: column;
  }

  .layout-cell {
    overflow: hidden;
    min-height: 0;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .layout-divider {
    flex-shrink: 0;
    background: var(--color-divider, #2a2a2a);
    z-index: 10;
    transition: background 0.15s;
  }

  .layout-divider:hover,
  .layout-divider.active {
    background: var(--color-divider-active, #6366f1);
  }

  .layout-divider-h {
    width: ${DIVIDER_SIZE}px;
    cursor: col-resize;
  }

  .layout-divider-v {
    height: ${DIVIDER_SIZE}px;
    cursor: row-resize;
  }

  .layout-tabs-header {
    display: flex;
    background: var(--color-panel-header, #141414);
    border-bottom: 1px solid var(--color-panel-border, #333);
    overflow-x: auto;
    flex-shrink: 0;
  }

  .layout-tab {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-muted-foreground, #999);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    user-select: none;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    font-family: inherit;
  }

  .layout-tab:hover {
    color: var(--color-foreground, #fff);
    background: var(--color-accent, #333);
  }

  .layout-tab.active {
    color: var(--color-foreground, #fff);
    border-bottom-color: var(--color-primary, #6366f1);
  }

  .layout-tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-left: 6px;
    border: none;
    background: transparent;
    color: var(--color-muted-foreground, #999);
    border-radius: 3px;
    cursor: pointer;
    font-size: 10px;
    line-height: 1;
    padding: 0;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }

  .layout-tab:hover .layout-tab-close,
  .layout-tab.active .layout-tab-close {
    opacity: 1;
  }

  .layout-tab-close:hover {
    background: var(--color-accent, #444);
    color: var(--color-foreground, #fff);
  }

  .layout-tab-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .layout-tabs-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .panel-slot {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .panel-slot > * {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .layout-tab[draggable="true"] {
    cursor: grab;
  }

  .layout-tab.dragging {
    opacity: 0.4;
  }

  .layout-tabs-header.drag-over {
    background: var(--color-primary-dim, rgba(99, 102, 241, 0.15));
    outline: 2px solid var(--color-primary, #6366f1);
    outline-offset: -2px;
  }

  .layout-tab-drop-indicator {
    width: 2px;
    background: var(--color-primary, #6366f1);
    flex-shrink: 0;
    align-self: stretch;
    border-radius: 1px;
    pointer-events: none;
  }

  .panel-slot.drag-over {
    outline: 2px solid var(--color-primary, #6366f1);
    outline-offset: -2px;
    background: var(--color-primary-dim, rgba(99, 102, 241, 0.08));
  }
`;

export class VePanelLayout extends HTMLElement {
  private _shadow: ShadowRoot;
  private _layout: LayoutNode | null = null;
  private _panelFactory: Map<string, () => HTMLElement> = new Map();
  private _panelCache: Map<string, HTMLElement> = new Map();
  private _resizing = false;
  private _resizeData: {
    nodeId: string;
    index: number;
    direction: "row" | "col";
    startPos: number;
    startSizes: number[];
    containerSize: number;
  } | null = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = layoutStyles;
    this._shadow.appendChild(style);
  }

  connectedCallback() {
    // Adopt document stylesheets so Tailwind classes work inside the shadow root
    this._adoptDocumentStyles();

    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("mouseup", this._onMouseUp);
  }

  private _styleObserver: MutationObserver | null = null;

  private _adoptDocumentStyles() {
    // Clone existing <style> and <link rel="stylesheet"> from <head>
    this._mirrorHeadStyles();

    // Watch for Vite HMR style injections / updates
    this._styleObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const node of m.addedNodes) {
            if (
              node instanceof HTMLStyleElement ||
              (node instanceof HTMLLinkElement && node.rel === "stylesheet")
            ) {
              this._mirrorStyleNode(node);
            }
          }
          for (const node of m.removedNodes) {
            if (node instanceof HTMLStyleElement || node instanceof HTMLLinkElement) {
              const id =
                (node as HTMLElement).getAttribute("data-vite-dev-id") ||
                (node as HTMLLinkElement).href;
              if (id) {
                const mirror = this._shadow.querySelector(
                  `[data-mirror-id="${CSS.escape(id)}"]`,
                );
                mirror?.remove();
              }
            }
          }
        }
        // Handle Vite HMR in-place text updates
        if (
          m.type === "characterData" &&
          m.target.parentElement instanceof HTMLStyleElement
        ) {
          const src = m.target.parentElement;
          const id = src.getAttribute("data-vite-dev-id");
          if (id) {
            const mirror = this._shadow.querySelector(
              `[data-mirror-id="${CSS.escape(id)}"]`,
            );
            if (mirror) mirror.textContent = src.textContent;
          }
        }
      }
    });
    this._styleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private _mirrorHeadStyles() {
    const nodes = document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style, link[rel="stylesheet"]',
    );
    nodes.forEach((node) => this._mirrorStyleNode(node));
  }

  private _mirrorStyleNode(node: HTMLStyleElement | HTMLLinkElement) {
    const id =
      node.getAttribute("data-vite-dev-id") || (node as HTMLLinkElement).href || "";
    // Avoid duplicates
    if (id && this._shadow.querySelector(`[data-mirror-id="${CSS.escape(id)}"]`))
      return;

    const clone = node.cloneNode(true) as HTMLElement;
    if (id) clone.setAttribute("data-mirror-id", id);
    this._shadow.insertBefore(clone, this._shadow.firstChild);
  }

  disconnectedCallback() {
    this._styleObserver?.disconnect();
    this._styleObserver = null;
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("mouseup", this._onMouseUp);
  }

  registerPanelFactory(panelId: string, factory: () => HTMLElement) {
    this._panelFactory.set(panelId, factory);
  }

  setLayout(layout: LayoutNode) {
    this._layout = layout;
    this._render();
  }

  getLayout(): LayoutNode | null {
    return this._layout;
  }

  private _render() {
    // Remove all children except <style> elements (layout styles + mirrored document styles)
    const styles = new Set(this._shadow.querySelectorAll("style"));
    const children = Array.from(this._shadow.childNodes);
    for (const child of children) {
      if (!styles.has(child as HTMLStyleElement)) {
        this._shadow.removeChild(child);
      }
    }

    if (!this._layout) return;
    const el = this._buildNode(this._layout);
    this._shadow.appendChild(el);
  }

  private _buildNode(node: LayoutNode): HTMLElement {
    switch (node.type) {
      case "row":
      case "col":
        return this._buildSplit(node);
      case "tabs":
        return this._buildTabs(node);
      case "panel":
        return this._buildPanel(node);
      default: {
        const div = document.createElement("div");
        div.textContent = `Unknown node type: ${String(node.type)}`;
        return div;
      }
    }
  }

  private _buildSplit(node: LayoutNode): HTMLElement {
    const container = document.createElement("div");
    container.className = node.type === "row" ? "layout-row" : "layout-col";

    const children = node.children || [];
    const sizes = node.sizes || children.map(() => 100 / children.length);

    children.forEach((child, i) => {
      const cell = document.createElement("div");
      cell.className = "layout-cell";
      if (node.type === "row") {
        cell.style.width = `${sizes[i]}%`;
        cell.style.height = "100%";
      } else {
        cell.style.height = `${sizes[i]}%`;
        cell.style.width = "100%";
      }

      const childEl = this._buildNode(child);
      cell.appendChild(childEl);
      container.appendChild(cell);

      // Add divider between children (not after last)
      if (i < children.length - 1) {
        const divider = document.createElement("div");
        divider.className = `layout-divider ${
          node.type === "row" ? "layout-divider-h" : "layout-divider-v"
        }`;
        divider.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this._startResize(node, i, container, e);
        });
        container.appendChild(divider);
      }
    });

    return container;
  }

  private _buildTabs(node: LayoutNode): HTMLElement {
    const container = document.createElement("div");
    container.className = "layout-tabs-container";

    const header = document.createElement("div");
    header.className = "layout-tabs-header";
    header.setAttribute("data-tabs-id", node.id);

    const content = document.createElement("div");
    content.className = "layout-tab-content";

    const children = node.children || [];
    const activeTab = node.activeTab ?? 0;

    children.forEach((child, i) => {
      const tab = document.createElement("button");
      tab.className = `layout-tab${i === activeTab ? " active" : ""}`;
      tab.setAttribute("draggable", "true");
      tab.setAttribute("data-panel-id", child.panelId || "");
      tab.setAttribute("data-tab-index", String(i));
      tab.setAttribute("data-tabs-node-id", node.id);

      // Drag start
      tab.addEventListener("dragstart", (e) => {
        if (!e.dataTransfer || !child.panelId) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/ve-panel-id", child.panelId);
        e.dataTransfer.setData("application/ve-source-tabs-id", node.id);
        tab.classList.add("dragging");
        // Defer so the drag image captures the non-dimmed state
        requestAnimationFrame(() => tab.classList.add("dragging"));
      });

      tab.addEventListener("dragend", () => {
        tab.classList.remove("dragging");
        this._clearAllDropIndicators();
      });

      const label = document.createElement("span");
      label.textContent = child.panelId
        ? this._getPanelName(child.panelId)
        : `Tab ${i + 1}`;
      tab.appendChild(label);

      const closeBtn = document.createElement("span");
      closeBtn.className = "layout-tab-close";
      closeBtn.textContent = "×";
      closeBtn.title = "Close";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (child.panelId) {
          this.dispatchEvent(
            new CustomEvent("panel-close", {
              bubbles: true,
              composed: true,
              detail: { panelId: child.panelId },
            }),
          );
        }
      });
      tab.appendChild(closeBtn);

      tab.addEventListener("click", () => {
        this._setActiveTab(node.id, i);
      });
      header.appendChild(tab);
    });

    // Drop target: tab header bar
    header.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("application/ve-panel-id")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      header.classList.add("drag-over");
      this._showTabDropIndicator(header, e.clientX);
    });

    header.addEventListener("dragleave", (e) => {
      // Only remove if actually leaving the header
      if (header.contains(e.relatedTarget as Node)) return;
      header.classList.remove("drag-over");
      this._removeTabDropIndicator(header);
    });

    header.addEventListener("drop", (e) => {
      e.preventDefault();
      header.classList.remove("drag-over");
      this._removeTabDropIndicator(header);

      const panelId = e.dataTransfer?.getData("application/ve-panel-id");
      const sourceTabsId = e.dataTransfer?.getData("application/ve-source-tabs-id");
      if (!panelId) return;

      // Dropping on the same tabs container at the same position is a no-op check
      const insertIndex = this._getTabInsertIndex(header, e.clientX);

      this.dispatchEvent(
        new CustomEvent("panel-move", {
          bubbles: true,
          composed: true,
          detail: {
            panelId,
            sourceTabsId: sourceTabsId || null,
            targetNodeId: node.id,
            insertIndex,
          },
        }),
      );
    });

    if (children[activeTab]) {
      const child = children[activeTab];
      // Render panel content directly — the tabs header already provides the tab bar
      const childEl =
        child.type === "panel"
          ? this._buildPanelContent(child)
          : this._buildNode(child);
      content.appendChild(childEl);
    }

    container.appendChild(header);
    container.appendChild(content);
    return container;
  }

  private _buildPanelContent(node: LayoutNode): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "panel-slot";
    slot.setAttribute("data-panel-id", node.panelId || "");
    slot.setAttribute("data-node-id", node.id);

    if (node.panelId && this._panelFactory.has(node.panelId)) {
      let panel = this._panelCache.get(node.panelId);
      if (!panel) {
        const factory = this._panelFactory.get(node.panelId)!;
        panel = factory();
        this._panelCache.set(node.panelId, panel);
      }
      slot.appendChild(panel);
    } else {
      slot.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-muted-foreground,#999);font-size:12px;">Panel: ${node.panelId || "empty"}</div>`;
    }

    return slot;
  }

  private _buildPanel(node: LayoutNode): HTMLElement {
    // Wrap every standalone panel in a tabs-like container with a single-tab header
    const container = document.createElement("div");
    container.className = "layout-tabs-container";

    const header = document.createElement("div");
    header.className = "layout-tabs-header";
    header.setAttribute("data-tabs-id", node.id);

    const content = document.createElement("div");
    content.className = "layout-tab-content";

    // Build the single tab button
    const tab = document.createElement("button");
    tab.className = "layout-tab active";
    tab.setAttribute("draggable", "true");
    tab.setAttribute("data-panel-id", node.panelId || "");
    tab.setAttribute("data-tabs-node-id", node.id);

    // Drag start
    tab.addEventListener("dragstart", (e) => {
      if (!e.dataTransfer || !node.panelId) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/ve-panel-id", node.panelId);
      e.dataTransfer.setData("application/ve-source-tabs-id", node.id);
      tab.classList.add("dragging");
      requestAnimationFrame(() => tab.classList.add("dragging"));
    });

    tab.addEventListener("dragend", () => {
      tab.classList.remove("dragging");
      this._clearAllDropIndicators();
    });

    const label = document.createElement("span");
    label.textContent = node.panelId ? this._getPanelName(node.panelId) : "Panel";
    tab.appendChild(label);

    const closeBtn = document.createElement("span");
    closeBtn.className = "layout-tab-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (node.panelId) {
        this.dispatchEvent(
          new CustomEvent("panel-close", {
            bubbles: true,
            composed: true,
            detail: { panelId: node.panelId },
          }),
        );
      }
    });
    tab.appendChild(closeBtn);

    header.appendChild(tab);

    // Drop target: header bar (merge into this panel as tabs)
    header.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("application/ve-panel-id")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      header.classList.add("drag-over");
      this._showTabDropIndicator(header, e.clientX);
    });

    header.addEventListener("dragleave", (e) => {
      if (header.contains(e.relatedTarget as Node)) return;
      header.classList.remove("drag-over");
      this._removeTabDropIndicator(header);
    });

    header.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove("drag-over");
      this._removeTabDropIndicator(header);

      const panelId = e.dataTransfer?.getData("application/ve-panel-id");
      if (!panelId || panelId === node.panelId) return;

      this.dispatchEvent(
        new CustomEvent("panel-move", {
          bubbles: true,
          composed: true,
          detail: {
            panelId,
            sourceTabsId:
              e.dataTransfer?.getData("application/ve-source-tabs-id") || null,
            targetNodeId: node.id,
            insertIndex: this._getTabInsertIndex(header, e.clientX),
          },
        }),
      );
    });

    // Build panel content
    const slot = document.createElement("div");
    slot.className = "panel-slot";
    slot.setAttribute("data-panel-id", node.panelId || "");
    slot.setAttribute("data-node-id", node.id);

    if (node.panelId && this._panelFactory.has(node.panelId)) {
      let panel = this._panelCache.get(node.panelId);
      if (!panel) {
        const factory = this._panelFactory.get(node.panelId)!;
        panel = factory();
        this._panelCache.set(node.panelId, panel);
      }
      slot.appendChild(panel);
    } else {
      slot.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-muted-foreground,#999);font-size:12px;">Panel: ${node.panelId || "empty"}</div>`;
    }

    content.appendChild(slot);
    container.appendChild(header);
    container.appendChild(content);
    return container;
  }

  private _getPanelName(panelId: string): string {
    const names: Record<string, string> = {
      "file-browser": "File Browser",
      "media-pool": "Media Pool",
      timeline: "Timeline",
      preview: "Preview",
      tools: "Tools",
      effects: "Effects",
      properties: "Properties",
      history: "History",
    };
    return names[panelId] || panelId;
  }

  private _startResize(
    node: LayoutNode,
    index: number,
    container: HTMLElement,
    e: MouseEvent,
  ) {
    this._resizing = true;
    const rect = container.getBoundingClientRect();
    const direction = node.type as "row" | "col";
    const containerSize = direction === "row" ? rect.width : rect.height;

    this._resizeData = {
      nodeId: node.id,
      index,
      direction,
      startPos: direction === "row" ? e.clientX : e.clientY,
      startSizes: [...(node.sizes || [])],
      containerSize,
    };

    // Highlight active divider
    const dividers = container.querySelectorAll(".layout-divider");
    dividers.forEach((d, i) => {
      if (i === index) d.classList.add("active");
    });

    // Prevent text selection during resize
    document.body.style.cursor = direction === "row" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }

  // Arrow-function fields so the listener identity is stable without a
  // constructor bind, and `this` can't be lost when detached.
  private _onMouseMove = (e: MouseEvent) => {
    if (!this._resizing || !this._resizeData || !this._layout) return;

    const { index, direction, startPos, startSizes, containerSize } = this._resizeData;
    const currentPos = direction === "row" ? e.clientX : e.clientY;
    const delta = currentPos - startPos;
    const deltaPercent = (delta / containerSize) * 100;

    const newSizes = [...startSizes];
    const newA = startSizes[index] + deltaPercent;
    const newB = startSizes[index + 1] - deltaPercent;

    if (newA >= MIN_PANEL_SIZE && newB >= MIN_PANEL_SIZE) {
      newSizes[index] = newA;
      newSizes[index + 1] = newB;

      // Update layout in place and re-render
      this._updateNodeSizes(this._layout, this._resizeData.nodeId, newSizes);
      this._render();
    }
  };

  private _onMouseUp = () => {
    if (!this._resizing) return;
    this._resizing = false;
    this._resizeData = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    // Dispatch event so SolidJS store can persist
    this.dispatchEvent(
      new CustomEvent("layout-change", {
        bubbles: true,
        composed: true,
        detail: { layout: JSON.parse(JSON.stringify(this._layout)) },
      }),
    );
  };

  private _updateNodeSizes(
    node: LayoutNode,
    targetId: string,
    sizes: number[],
  ): boolean {
    if (node.id === targetId) {
      node.sizes = sizes;
      return true;
    }
    if (node.children) {
      for (const child of node.children) {
        if (this._updateNodeSizes(child, targetId, sizes)) return true;
      }
    }
    return false;
  }

  private _setActiveTab(nodeId: string, tabIndex: number) {
    if (!this._layout) return;
    this._updateActiveTab(this._layout, nodeId, tabIndex);
    this._render();

    this.dispatchEvent(
      new CustomEvent("layout-change", {
        bubbles: true,
        composed: true,
        detail: { layout: JSON.parse(JSON.stringify(this._layout)) },
      }),
    );
  }

  private _updateActiveTab(
    node: LayoutNode,
    targetId: string,
    tabIndex: number,
  ): boolean {
    if (node.id === targetId) {
      node.activeTab = tabIndex;
      return true;
    }
    if (node.children) {
      for (const child of node.children) {
        if (this._updateActiveTab(child, targetId, tabIndex)) return true;
      }
    }
    return false;
  }

  private _showTabDropIndicator(header: HTMLElement, clientX: number) {
    this._removeTabDropIndicator(header);

    const tabs = Array.from(header.querySelectorAll<HTMLElement>(".layout-tab"));
    const indicator = document.createElement("div");
    indicator.className = "layout-tab-drop-indicator";

    let insertBefore: HTMLElement | null = null;
    for (const tab of tabs) {
      const rect = tab.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        insertBefore = tab;
        break;
      }
    }

    if (insertBefore) {
      header.insertBefore(indicator, insertBefore);
    } else {
      header.appendChild(indicator);
    }
  }

  private _removeTabDropIndicator(header: HTMLElement) {
    const existing = header.querySelector(".layout-tab-drop-indicator");
    if (existing) existing.remove();
  }

  private _getTabInsertIndex(header: HTMLElement, clientX: number): number {
    const tabs = Array.from(header.querySelectorAll<HTMLElement>(".layout-tab"));
    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return i;
      }
    }
    return tabs.length;
  }

  private _clearAllDropIndicators() {
    const indicators = this._shadow.querySelectorAll(".layout-tab-drop-indicator");
    indicators.forEach((el) => el.remove());

    const dragOvers = this._shadow.querySelectorAll(".drag-over");
    dragOvers.forEach((el) => el.classList.remove("drag-over"));
  }
}

customElements.define("ve-panel-layout", VePanelLayout);
