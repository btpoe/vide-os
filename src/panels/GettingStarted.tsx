/**
 * What to do first.
 *
 * The app opens on an empty timeline and a black preview, and nothing on screen
 * says how to get material into it — the import is behind a panel button, and
 * the editing model (drag to the timeline, three-point from the source monitor)
 * is not guessable from the layout. Six lines here is the difference between
 * an editor and a puzzle.
 *
 * Deliberately short. Anything longer belongs in `docs/`, which this points at.
 */

import { Component, For } from "solid-js";
import { formatChord, getCommand } from "@/commands";

/** The chord for a command, or nothing if it has none. */
function keys(id: string): string {
  const shortcut = getCommand(id)?.shortcut;
  return shortcut ? formatChord(shortcut) : "";
}

const GettingStarted: Component<{ onShowShortcuts: () => void }> = (props) => {
  const steps = () => [
    {
      title: "Bring in some media",
      body: "Media Pool → Import, or drop files onto the pool. Files stay where they are on disk; the project records where they live rather than copying them.",
    },
    {
      title: "Put it on the timeline",
      body: "Drag a clip from the pool onto a track, or open it in the Source monitor, mark in and out, and insert it at the playhead.",
      chord: [keys("source.markIn"), keys("source.markOut"), keys("source.insert")]
        .filter(Boolean)
        .join(" · "),
    },
    {
      title: "Move around",
      body: "Space plays. The arrow keys step one frame. J and L shuttle, and hold them to go faster.",
      chord: keys("playback.toggle"),
    },
    {
      title: "Edit",
      body: "V is the selection tool, C cuts, T trims a cut from either side, and Y and U slip and slide. Every edit is one undo step, including a whole drag.",
      chord: keys("edit.undo"),
    },
    {
      title: "Adjust",
      body: "Select a clip and use Properties for transform, opacity and speed, or Effects to add a filter. The diamond next to a value keyframes it.",
    },
    {
      title: "Export",
      body: "File → Export writes the sequence out frame by frame, timestamped from the timeline rather than from the clock, so the result is the same every time.",
      chord: keys("file.export"),
    },
  ];

  return (
    <div class="px-5 py-4 space-y-3 text-xs">
      <For each={steps()}>
        {(step, index) => (
          <div class="flex gap-3">
            <span class="text-primary font-mono shrink-0">{index() + 1}</span>
            <div class="space-y-0.5">
              <div class="flex items-baseline gap-2">
                <span class="text-foreground font-semibold">{step.title}</span>
                {step.chord && (
                  <span class="font-mono text-[10px] text-muted-foreground">
                    {step.chord}
                  </span>
                )}
              </div>
              <p class="text-muted-foreground leading-relaxed">{step.body}</p>
            </div>
          </div>
        )}
      </For>

      <div class="pt-2 border-t border-border flex items-center justify-between">
        <span class="text-muted-foreground">
          Everything the keyboard does is in the shortcut reference.
        </span>
        <button
          class="px-3 py-1 rounded bg-secondary text-foreground hover:bg-accent"
          onClick={props.onShowShortcuts}
        >
          Shortcuts {keys("help.shortcuts")}
        </button>
      </div>
    </div>
  );
};

export default GettingStarted;
