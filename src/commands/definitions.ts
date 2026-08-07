/**
 * Every user-triggerable action in the app, in one list.
 *
 * Adding a shortcut, a menu item, or a toolbar button means adding a command
 * here — never a second implementation of an action that already exists.
 */

import { doc, playheadFrame, sequenceFrameRate } from "@/stores/project-store";
import {
  togglePlayback,
  pause,
  shuttle,
  stepFrames,
  seekToFrame,
} from "@/playback/transport";
import { secondsToFrames } from "@/lib/timecode";
import { contentEndFrame } from "@/model/doc";
import {
  timelineState,
  toggleSnap,
  selectAllClips,
  clearSelection,
} from "@/stores/timeline-store";
import {
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToFrameLevel,
  revealFrame,
} from "@/stores/timeline-view-store";
import { undo, redo, canUndo, canRedo } from "@/stores/history-store";
import { setSelectedTool } from "@/stores/ui-store";
import type { Command } from "./registry";
import { deleteSelectedClips, nudgeSelectedClips, hasSelection } from "./clip-edits";

/**
 * Moves the playhead and scrolls it into view.
 *
 * Stepping the playhead off the edge of the visible range and leaving it there
 * would mean the transport controls silently stop showing you anything.
 */
function seekTo(seconds: number): void {
  const frame = secondsToFrames(seconds, sequenceFrameRate());
  seekToFrame(frame);
  revealFrame(frame);
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
    id: "playback.stop",
    label: "Stop",
    shortcut: "K",
    category: "Playback",
    run: pause,
  },
  {
    id: "playback.goToStart",
    label: "Go to Start",
    shortcut: "Home",
    category: "Playback",
    run: () => seekTo(0),
  },
  {
    id: "playback.goToEnd",
    label: "Go to End",
    shortcut: "End",
    category: "Playback",
    // The end of the content, not a fixed project length — the old
    // projection reported a default 300s whatever the timeline held.
    run: () => seekToFrame(contentEndFrame(doc())),
  },
  {
    id: "playback.prevFrame",
    label: "Previous Frame",
    shortcut: "ArrowLeft",
    category: "Playback",
    run: () => {
      stepFrames(-1);
      revealFrame(playheadFrame());
    },
  },
  {
    id: "playback.nextFrame",
    label: "Next Frame",
    shortcut: "ArrowRight",
    category: "Playback",
    run: () => {
      stepFrames(1);
      revealFrame(playheadFrame());
    },
  },
  // Real J/K/L shuttle: repeated presses step through the rate ladder, K
  // stops. These used to be plain five-second jumps, which the shortcut sheet
  // nonetheless described as shuttle.
  {
    id: "playback.shuttleBack",
    label: "Shuttle Back",
    shortcut: "J",
    category: "Playback",
    run: () => shuttle(-1),
  },
  {
    id: "playback.shuttleForward",
    label: "Shuttle Forward",
    shortcut: "L",
    category: "Playback",
    run: () => shuttle(1),
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
    label: "Nudge Left One Frame",
    shortcut: "Shift+ArrowLeft",
    category: "Editing",
    enabled: hasSelection,
    run: () => nudgeSelectedClips(-1),
  },
  {
    id: "edit.nudgeRight",
    label: "Nudge Right One Frame",
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
    id: "timeline.zoomFit",
    label: "Zoom to Fit",
    shortcut: "Shift+Z",
    category: "Timeline",
    run: zoomToFit,
  },
  {
    id: "timeline.zoomFrame",
    label: "Zoom to Frame Level",
    shortcut: "Mod+0",
    category: "Timeline",
    run: zoomToFrameLevel,
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
