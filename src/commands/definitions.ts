/**
 * Every user-triggerable action in the app, in one list.
 *
 * Adding a shortcut, a menu item, or a toolbar button means adding a command
 * here — never a second implementation of an action that already exists.
 */

import { projectState, setPlayhead, togglePlayback } from "@/stores/project-store";
import {
  timelineState,
  toggleSnap,
  selectAllClips,
  clearSelection,
  zoomIn,
  zoomOut,
  resetZoom,
} from "@/stores/timeline-store";
import { undo, redo, canUndo, canRedo } from "@/stores/history-store";
import { setSelectedTool } from "@/stores/ui-store";
import type { Command } from "./registry";
import { deleteSelectedClips, nudgeSelectedClips, hasSelection } from "./clip-edits";

/** One frame in seconds, at the project's frame rate. */
function frameStep(): number {
  return 1 / projectState.fps;
}

export const commands: Command[] = [
  // ── Playback ───────────────────────────────────────────────────────
  {
    id: "playback.toggle",
    label: "Play / Pause",
    shortcut: "Space",
    category: "Playback",
    run: togglePlayback,
  },
  {
    id: "playback.toggle.k",
    label: "Play / Pause (K)",
    shortcut: "K",
    category: "Playback",
    run: togglePlayback,
  },
  {
    id: "playback.goToStart",
    label: "Go to Start",
    shortcut: "Home",
    category: "Playback",
    run: () => setPlayhead(0),
  },
  {
    id: "playback.goToEnd",
    label: "Go to End",
    shortcut: "End",
    category: "Playback",
    run: () => setPlayhead(projectState.duration),
  },
  {
    id: "playback.prevFrame",
    label: "Previous Frame",
    shortcut: "ArrowLeft",
    category: "Playback",
    run: () => setPlayhead(projectState.playheadPosition - frameStep()),
  },
  {
    id: "playback.nextFrame",
    label: "Next Frame",
    shortcut: "ArrowRight",
    category: "Playback",
    run: () => setPlayhead(projectState.playheadPosition + frameStep()),
  },
  // J/K/L are shuttle controls in a real NLE (reverse / pause / forward, with
  // repeated presses increasing rate). These are plain 5-second jumps until
  // the playback clock supports variable rate.
  {
    id: "playback.back5",
    label: "Back 5 Seconds",
    shortcut: "J",
    category: "Playback",
    run: () => setPlayhead(projectState.playheadPosition - 5),
  },
  {
    id: "playback.forward5",
    label: "Forward 5 Seconds",
    shortcut: "L",
    category: "Playback",
    run: () => setPlayhead(projectState.playheadPosition + 5),
  },

  // ── Editing ────────────────────────────────────────────────────────
  {
    id: "edit.delete",
    label: "Delete",
    shortcut: "Delete",
    category: "Editing",
    enabled: hasSelection,
    run: deleteSelectedClips,
  },
  {
    id: "edit.delete.backspace",
    label: "Delete (Backspace)",
    shortcut: "Backspace",
    category: "Editing",
    enabled: hasSelection,
    run: deleteSelectedClips,
  },
  {
    id: "edit.nudgeLeft",
    label: "Nudge Left",
    shortcut: "Shift+ArrowLeft",
    category: "Editing",
    enabled: hasSelection,
    run: () => nudgeSelectedClips(-1),
  },
  {
    id: "edit.nudgeRight",
    label: "Nudge Right",
    shortcut: "Shift+ArrowRight",
    category: "Editing",
    enabled: hasSelection,
    run: () => nudgeSelectedClips(1),
  },
  {
    id: "edit.selectAll",
    label: "Select All",
    shortcut: "Mod+A",
    category: "Editing",
    run: selectAllClips,
  },
  {
    id: "edit.deselectAll",
    label: "Deselect All",
    shortcut: "Escape",
    category: "Editing",
    enabled: hasSelection,
    run: clearSelection,
  },
  {
    id: "edit.undo",
    label: "Undo",
    shortcut: "Mod+Z",
    category: "Editing",
    enabled: canUndo,
    run: () => void undo(),
  },
  {
    id: "edit.redo",
    label: "Redo",
    shortcut: "Mod+Shift+Z",
    category: "Editing",
    enabled: canRedo,
    run: () => void redo(),
  },

  // ── Timeline ───────────────────────────────────────────────────────
  {
    id: "timeline.toggleSnap",
    label: "Toggle Snapping",
    shortcut: "S",
    category: "Timeline",
    run: toggleSnap,
  },
  {
    id: "timeline.zoomIn",
    label: "Zoom In",
    shortcut: "Mod+=",
    category: "Timeline",
    run: zoomIn,
  },
  {
    id: "timeline.zoomOut",
    label: "Zoom Out",
    shortcut: "Mod+-",
    category: "Timeline",
    run: zoomOut,
  },
  {
    id: "timeline.zoomReset",
    label: "Reset Zoom",
    shortcut: "Mod+0",
    category: "Timeline",
    run: resetZoom,
  },

  // ── Tools ──────────────────────────────────────────────────────────
  // Only tools the timeline actually implements get a shortcut. Trim, slip
  // and slide are registered nowhere until they do something.
  {
    id: "tool.select",
    label: "Select Tool",
    shortcut: "V",
    category: "Tools",
    run: () => setSelectedTool("select"),
  },
  {
    id: "tool.razor",
    label: "Razor Tool",
    shortcut: "C",
    category: "Tools",
    run: () => setSelectedTool("razor"),
  },
  {
    id: "tool.text",
    label: "Text Tool",
    shortcut: "X",
    category: "Tools",
    run: () => setSelectedTool("text"),
  },
  {
    id: "tool.hand",
    label: "Hand Tool",
    shortcut: "H",
    category: "Tools",
    run: () => setSelectedTool("hand"),
  },
];

/** Re-exported so panels can read selection state without importing the store. */
export { timelineState };
