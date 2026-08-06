import { createStore } from "solid-js/store";

export interface HistoryEntry {
  id: number;
  action: string;
  icon: string;
  timestamp: number;
  undo: () => void;
  redo: () => void;
}

export interface HistoryState {
  entries: HistoryEntry[];
  currentIndex: number;
}

let nextId = 1;

const [historyState, setHistoryState] = createStore<HistoryState>({
  entries: [
    {
      id: 0,
      action: "Project Created",
      icon: "📄",
      timestamp: Date.now(),
      undo: () => {},
      redo: () => {},
    },
  ],
  currentIndex: 0,
});

const MAX_HISTORY = 100;

export function pushAction(
  action: string,
  icon: string,
  undo: () => void,
  redo: () => void,
): void {
  const entry: HistoryEntry = {
    id: nextId++,
    action,
    icon,
    timestamp: Date.now(),
    undo,
    redo,
  };

  // Truncate any redo entries beyond current index
  const truncated = historyState.entries.slice(0, historyState.currentIndex + 1);
  const newEntries = [...truncated, entry].slice(-MAX_HISTORY);

  setHistoryState({
    entries: newEntries,
    currentIndex: newEntries.length - 1,
  });
}

export function undo(): boolean {
  if (historyState.currentIndex <= 0) return false;
  const entry = historyState.entries[historyState.currentIndex];
  entry.undo();
  setHistoryState("currentIndex", historyState.currentIndex - 1);
  return true;
}

export function redo(): boolean {
  if (historyState.currentIndex >= historyState.entries.length - 1) return false;
  const nextEntry = historyState.entries[historyState.currentIndex + 1];
  nextEntry.redo();
  setHistoryState("currentIndex", historyState.currentIndex + 1);
  return true;
}

export function canUndo(): boolean {
  return historyState.currentIndex > 0;
}

export function canRedo(): boolean {
  return historyState.currentIndex < historyState.entries.length - 1;
}

export function goToEntry(index: number): void {
  if (index < 0 || index >= historyState.entries.length) return;
  if (index === historyState.currentIndex) return;

  if (index < historyState.currentIndex) {
    // Undo steps
    for (let i = historyState.currentIndex; i > index; i--) {
      historyState.entries[i].undo();
    }
  } else {
    // Redo steps
    for (let i = historyState.currentIndex + 1; i <= index; i++) {
      historyState.entries[i].redo();
    }
  }
  setHistoryState("currentIndex", index);
}

export { historyState, setHistoryState };
