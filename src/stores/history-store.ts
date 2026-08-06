/**
 * Undo history, as seen by the UI.
 *
 * The real history lives in `model/history.ts` as document snapshots and is
 * driven by the project store — every operation there records its own step.
 * This module is now only a read-side view for the History panel plus the
 * undo/redo commands.
 *
 * `pushAction` used to be how each mutation registered a hand-written inverse.
 * It no longer needs to exist: snapshots cannot be wrong, and three of those
 * inverses were. It is kept as a no-op that complains in development, so a
 * missed call site is noticed rather than silently adding a second, broken
 * entry beside the real one.
 */

import {
  canRedo as storeCanRedo,
  canUndo as storeCanUndo,
  goToEntry as storeGoToEntry,
  historyEntries,
  redo as storeRedo,
  undo as storeUndo,
} from "@/stores/project-store";

export interface HistoryEntry {
  action: string;
  icon: string;
  timestamp: number;
}

export interface HistoryView {
  entries: HistoryEntry[];
  /** Position in `entries`; anything at or after it is redoable. */
  currentIndex: number;
}

/** Reactive view of the undo stack, for the History panel. */
export function historyState(): HistoryView {
  const { entries, currentIndex } = historyEntries();
  return {
    entries: entries.map((entry) => ({
      action: entry.label,
      icon: entry.icon,
      timestamp: entry.at,
    })),
    currentIndex,
  };
}

export function undo(): boolean {
  return storeUndo();
}

export function redo(): boolean {
  return storeRedo();
}

export function canUndo(): boolean {
  return storeCanUndo();
}

export function canRedo(): boolean {
  return storeCanRedo();
}

export function goToEntry(index: number): void {
  storeGoToEntry(index);
}

/**
 * @deprecated Every project-store operation records its own undo step, so this
 * does nothing. Remove the call.
 */
export function pushAction(
  action: string,
  _icon: string,
  _undoFn: () => void,
  _redoFn: () => void,
): void {
  if (import.meta.env?.DEV) {
    console.warn(
      `pushAction(${JSON.stringify(action)}) is obsolete — the edit already recorded an undo step. Remove this call.`,
    );
  }
}
