import { createStore } from "solid-js/store";

export interface LayoutPosition {
  area: "left" | "center-top" | "center-bottom" | "right";
  order?: number;
}

export interface PanelDefinition {
  id: string;
  name: string;
  icon: string;
  category: "media" | "editing" | "effects" | "utility" | "custom";
  component: () => HTMLElement;
  defaultPosition?: LayoutPosition;
}

interface RegistryState {
  panels: PanelDefinition[];
  activePanels: string[];
}

const [state, setState] = createStore<RegistryState>({
  panels: [],
  activePanels: [],
});

export function registerPanel(definition: PanelDefinition): void {
  setState("panels", (prev) => {
    if (prev.some((p) => p.id === definition.id)) return prev;
    return [...prev, definition];
  });
}

export function unregisterPanel(id: string): void {
  setState("panels", (prev) => prev.filter((p) => p.id !== id));
  setState("activePanels", (prev) => prev.filter((pid) => pid !== id));
}

export function getPanels(): PanelDefinition[] {
  return state.panels;
}

export function getActivePanels(): string[] {
  return state.activePanels;
}

export function activatePanel(id: string): void {
  setState("activePanels", (prev) => {
    if (prev.includes(id)) return prev;
    return [...prev, id];
  });
}

export function deactivatePanel(id: string): void {
  setState("activePanels", (prev) => prev.filter((pid) => pid !== id));
}

export function getPanelById(id: string): PanelDefinition | undefined {
  return state.panels.find((p) => p.id === id);
}

export { state as registryState };
