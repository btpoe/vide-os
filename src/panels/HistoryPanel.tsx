import { Component, For } from "solid-js";
import {
  historyState,
  undo,
  redo,
  canUndo,
  canRedo,
  goToEntry,
} from "@/stores/history-store";

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
};

const HistoryPanel: Component = () => {
  return (
    <div class="h-full flex flex-col text-sm">
      <div class="flex items-center justify-between p-2 border-b border-border">
        <span class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
          History ({historyState.entries.length})
        </span>
        <div class="flex gap-1">
          <button
            class={`px-1.5 py-0.5 text-[10px] rounded ${
              canUndo()
                ? "text-foreground hover:bg-accent cursor-pointer"
                : "text-muted-foreground/30 cursor-default"
            }`}
            title="Undo (⌘Z)"
            onClick={() => undo()}
            disabled={!canUndo()}
          >
            ↩
          </button>
          <button
            class={`px-1.5 py-0.5 text-[10px] rounded ${
              canRedo()
                ? "text-foreground hover:bg-accent cursor-pointer"
                : "text-muted-foreground/30 cursor-default"
            }`}
            title="Redo (⌘⇧Z)"
            onClick={() => redo()}
            disabled={!canRedo()}
          >
            ↪
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-auto">
        <For each={historyState.entries}>
          {(entry, index) => (
            <div
              class={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border/30 transition-colors ${
                index() === historyState.currentIndex
                  ? "bg-primary/10 text-foreground"
                  : index() > historyState.currentIndex
                    ? "text-muted-foreground/40 hover:bg-accent/50"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              onClick={() => goToEntry(index())}
              title={
                index() > historyState.currentIndex
                  ? "Redo to this point"
                  : "Undo to this point"
              }
            >
              <span class="text-sm">{entry.icon}</span>
              <span class="text-xs flex-1 truncate">{entry.action}</span>
              <span class="text-[10px] opacity-50">
                {formatTimestamp(entry.timestamp)}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default HistoryPanel;
