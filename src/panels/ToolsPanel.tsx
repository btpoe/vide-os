import { Component, For } from "solid-js";
import { uiState, setSelectedTool } from "@/stores/ui-store";

interface Tool {
  id: string;
  name: string;
  icon: string;
  shortcut: string;
}

const tools: Tool[] = [
  { id: "select", name: "Select", icon: "⬚", shortcut: "V" },
  { id: "razor", name: "Razor", icon: "✂", shortcut: "C" },
  { id: "trim", name: "Trim", icon: "⟷", shortcut: "T" },
  { id: "slip", name: "Slip", icon: "⇔", shortcut: "Y" },
  { id: "slide", name: "Slide", icon: "⇹", shortcut: "U" },
  { id: "text", name: "Text", icon: "T", shortcut: "X" },
  { id: "hand", name: "Hand", icon: "✋", shortcut: "H" },
  { id: "zoom", name: "Zoom", icon: "🔍", shortcut: "Z" },
];

const ToolsPanel: Component = () => {
  return (
    <div class="h-full flex flex-wrap content-start p-1.5 gap-1">
      <For each={tools}>
        {(tool) => (
          <div class="relative group">
            <button
              onClick={() => setSelectedTool(tool.id)}
              class={`flex items-center justify-center w-8 h-8 rounded text-base transition-colors ${
                uiState.selectedTool === tool.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {tool.icon}
            </button>
            <div class="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 rounded bg-popover text-popover-foreground text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-md border border-border z-50">
              {tool.name}{" "}
              <span class="text-muted-foreground ml-1">({tool.shortcut})</span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};

export default ToolsPanel;
