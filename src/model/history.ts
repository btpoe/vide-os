/**
 * Undo/redo by document snapshots with structural sharing.
 *
 * This replaces command-based undo, where every mutation had to ship a
 * hand-written inverse. Three of those inverses were wrong — split-undo was
 * stubbed, trim-redo was empty, and delete-undo re-added clips with fresh ids
 * while dropping effects, in/out points and transitions, so its paired redo
 * removed by an id that no longer existed. Each was invisible until a user hit
 * it, and every new feature was another chance to add one.
 *
 * A snapshot cannot be wrong: undo is `past.pop()`. `mutative` gives structural
 * sharing, so an untouched track is shared by reference between revisions and a
 * step on a large project costs kilobytes rather than a full copy.
 *
 * This module is pure state — no Solid, no DOM. `stores/project-store.ts` wires
 * it to reactivity.
 */

import { create } from "mutative";
import type { ProjectDoc } from "./doc";
import { assertDocValid } from "./invariants";

/** Undo depth. Snapshots are cheap, but not free. */
export const MAX_HISTORY = 200;

/**
 * How long two edits sharing a coalesce key are merged into one step, in
 * milliseconds. Long enough that a slider drag is a single undo, short enough
 * that two deliberate nudges are two.
 */
export const COALESCE_WINDOW_MS = 500;

export interface HistoryEntry {
  label: string;
  icon: string;
  /** When the edit was made, for the History panel. */
  at: number;
  doc: ProjectDoc;
  /**
   * What was selected when this edit was made, so undo restores context rather
   * than leaving the user looking at a timeline with nothing highlighted.
   */
  selection: readonly ClipRef[];
}

export interface ClipRef {
  trackId: string;
  clipId: string;
}

export interface HistoryState {
  present: ProjectDoc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Set while an interaction (drag, trim) is in flight. */
  interaction: {
    baseDoc: ProjectDoc;
    baseSelection: readonly ClipRef[];
  } | null;
  lastCoalesceKey: string | null;
  lastEditAt: number;
}

export interface ApplyOptions {
  icon?: string;
  /**
   * Edits sharing a key within the coalesce window collapse into one step.
   * Use for continuous input — slider drags, typing in a text field.
   */
  coalesceKey?: string;
  /** Selection to record with this step. */
  selection?: readonly ClipRef[];
  /** Overrides the clock, for tests. */
  now?: number;
}

export function createHistory(doc: ProjectDoc): HistoryState {
  return {
    present: doc,
    past: [],
    future: [],
    interaction: null,
    lastCoalesceKey: null,
    lastEditAt: 0,
  };
}

/**
 * Deep equality that checks reference identity first at every level.
 *
 * Because `mutative` shares untouched subtrees, this walks only the parts a
 * drag actually touched — comparing two revisions of a 5000-clip project where
 * one clip moved costs a handful of comparisons, not a full traversal.
 *
 * Needed because a drag that returns to its starting position produces a doc
 * that is structurally identical but referentially new, and recording that as
 * an undo step would leave a step that does nothing.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (
      !deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a single recipe changed anything. Reference inequality is sufficient
 * here: `mutative` returns the original object when a recipe touches nothing.
 */
function changed(before: ProjectDoc, after: ProjectDoc): boolean {
  return before !== after;
}

/**
 * Applies a recipe to the document and pushes an undo step.
 *
 * The recipe's return value is discarded — edit operations return the objects
 * they create, and `mutative` rejects a recipe that returns a draft.
 */
export function applyEdit(
  state: HistoryState,
  label: string,
  recipe: (draft: ProjectDoc) => unknown,
  options: ApplyOptions = {},
): HistoryState {
  const next = create(state.present, (draft) => {
    recipe(draft);
  });

  // A no-op edit must not consume an undo step; otherwise clicking a slider
  // without moving it buries the user's real last action.
  if (!changed(state.present, next)) return state;

  if (import.meta.env?.DEV) assertDocValid(next, `document after "${label}"`);

  // While an interaction is in flight the document updates live but no step is
  // pushed; `commitInteraction` records the whole drag as one entry.
  if (state.interaction) {
    return { ...state, present: next };
  }

  const now = options.now ?? Date.now();
  const icon = options.icon ?? "✏️";
  const selection = options.selection ?? [];

  const coalesces =
    options.coalesceKey != null &&
    options.coalesceKey === state.lastCoalesceKey &&
    now - state.lastEditAt < COALESCE_WINDOW_MS &&
    state.past.length > 0;

  if (coalesces) {
    // Replace the present without adding a step — the existing top of the
    // undo stack already holds the document from before the drag began.
    return {
      ...state,
      present: next,
      future: [],
      lastEditAt: now,
    };
  }

  const past = [
    ...state.past,
    { label, icon, at: now, doc: state.present, selection },
  ].slice(-MAX_HISTORY);

  return {
    present: next,
    past,
    future: [],
    interaction: null,
    lastCoalesceKey: options.coalesceKey ?? null,
    lastEditAt: now,
  };
}

/**
 * Begins a continuous interaction. Subsequent `applyEdit` calls mutate the
 * document without pushing steps, so a 200-frame drag is one undo, and the
 * intermediate documents are never retained.
 */
export function beginInteraction(
  state: HistoryState,
  selection: readonly ClipRef[] = [],
): HistoryState {
  if (state.interaction) return state;
  return {
    ...state,
    interaction: { baseDoc: state.present, baseSelection: selection },
  };
}

/** Ends an interaction, recording one step for everything it changed. */
export function commitInteraction(
  state: HistoryState,
  label: string,
  options: { icon?: string; now?: number } = {},
): HistoryState {
  const interaction = state.interaction;
  if (!interaction) return state;

  // A drag that ended where it started is not an edit. This needs a value
  // comparison, not a reference one: every intermediate frame of the drag
  // produced a new document object, so the final one is never the same object
  // as the base even when it holds identical values.
  if (deepEqual(interaction.baseDoc, state.present)) {
    return { ...state, present: interaction.baseDoc, interaction: null };
  }

  const past = [
    ...state.past,
    {
      label,
      icon: options.icon ?? "✏️",
      at: options.now ?? Date.now(),
      doc: interaction.baseDoc,
      selection: interaction.baseSelection,
    },
  ].slice(-MAX_HISTORY);

  return {
    present: state.present,
    past,
    future: [],
    interaction: null,
    lastCoalesceKey: null,
    lastEditAt: options.now ?? Date.now(),
  };
}

/** Abandons an interaction, restoring the document from before it began. */
export function abortInteraction(state: HistoryState): HistoryState {
  const interaction = state.interaction;
  if (!interaction) return state;
  return { ...state, present: interaction.baseDoc, interaction: null };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

export function undo(state: HistoryState): HistoryState {
  const entry = state.past[state.past.length - 1];
  if (!entry) return state;

  return {
    ...state,
    present: entry.doc,
    past: state.past.slice(0, -1),
    // The redo entry carries the document we are leaving, so redo restores it.
    future: [
      {
        label: entry.label,
        icon: entry.icon,
        at: entry.at,
        doc: state.present,
        selection: entry.selection,
      },
      ...state.future,
    ],
    interaction: null,
    lastCoalesceKey: null,
  };
}

export function redo(state: HistoryState): HistoryState {
  const entry = state.future[0];
  if (!entry) return state;

  return {
    ...state,
    present: entry.doc,
    past: [
      ...state.past,
      {
        label: entry.label,
        icon: entry.icon,
        at: entry.at,
        doc: state.present,
        selection: entry.selection,
      },
    ].slice(-MAX_HISTORY),
    future: state.future.slice(1),
    interaction: null,
    lastCoalesceKey: null,
  };
}

/**
 * Entries for the History panel, oldest first, plus the index of the current
 * position. Index `past.length` is the present.
 */
export function historyEntries(state: HistoryState): {
  entries: { label: string; icon: string; at: number }[];
  currentIndex: number;
} {
  const summarise = (e: HistoryEntry) => ({
    label: e.label,
    icon: e.icon,
    at: e.at,
  });
  return {
    entries: [...state.past.map(summarise), ...state.future.map(summarise)],
    currentIndex: state.past.length,
  };
}

/**
 * Jumps to an arbitrary point in the timeline of edits — the History panel's
 * click-to-time-travel. `index` is a position in `historyEntries().entries`.
 */
export function goToEntry(state: HistoryState, index: number): HistoryState {
  const target = Math.max(0, Math.min(state.past.length + state.future.length, index));
  let next = state;
  while (next.past.length > target && canUndo(next)) next = undo(next);
  while (next.past.length < target && canRedo(next)) next = redo(next);
  return next;
}

/** Replaces the document and clears history — opening a project, not an edit. */
export function resetHistory(doc: ProjectDoc): HistoryState {
  return createHistory(doc);
}
