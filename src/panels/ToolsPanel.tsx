import { Component, For } from "solid-js";
import { uiState, setSelectedTool } from "@/stores/ui-store";

interface Tool {
  id: string;
  name: string;
  icon: string;
  shortcut: string;
  /**
   * Whether the timeline actually implements this tool. Ripple/roll/slip/slide
   * land in a later phase; until then they render disabled rather than
   * selectable-but-inert, which reads as a broken tool.
   */
  implemented: boolean;
  note?: string;
}

const tools: Tool[] = [
  { id: "select", name: "Select", icon: "⬚", shortcut: "V", implemented: true },
  { id: "razor", name: "Razor", icon: "✂", shortcut: "C", implemented: true },
  {
    id: "trim",
    name: "Trim",
    icon: "⟷",
    shortcut: "T",
    implemented: false,
    note: "Drag a clip edge with the Select tool for now",
  },
  {
    id: "slip",
    name: "Slip",
    icon: "⇔",
    shortcut: "Y",
    implemented: false,
    note: "Not implemented yet",
  },
  {
    id: "slide",
    name: "Slide",
    icon: "⇹",
    shortcut: "U",
    implemented: false,
    note: "Not implemented yet",
  },
  {
    id: "text",
    name: "Text",
    icon: "T",
    shortcut: "X",
    implemented: true,
    note: "Creates a title clip — rendering is not wired up yet",
  },
  { id: "hand", name: "Hand", icon: "✋", shortcut: "H", implemented: true },
];

const ToolsPanel: Component = () => {
  return (
    <div class="h-full flex flex-wrap content-start p-1.5 gap-1">
      <For each={tools}>
        {(tool) => (
          <div class="relative group">
            <button
              onClick={() => tool.implemented && setSelectedTool(tool.id)}
              disabled={!tool.implemented}
              class={`flex items-center justify-center w-8 h-8 rounded text-base transition-colors ${
                !tool.implemented
                  ? "text-muted-foreground/30 cursor-not-allowed"
                  : uiState.selectedTool === tool.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {tool.icon}
            </button>
            <div class="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 rounded bg-popover text-popover-foreground text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-md border border-border z-50">
              {tool.name}{" "}
              <span class="text-muted-foreground ml-1">({tool.shortcut})</span>
              {tool.note && (
                <div class="text-muted-foreground text-[10px] mt-0.5">{tool.note}</div>
              )}
            </div>
          </div>
        )}
      </For>
    </div>
  );
};

export default ToolsPanel;
