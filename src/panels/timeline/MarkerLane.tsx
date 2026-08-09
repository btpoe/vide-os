import { Component, For, createSignal, createMemo, Show } from "solid-js";
import { frameToContentX } from "@/lib/timeline-geometry";
import { timelineView } from "@/stores/timeline-view-store";
import {
  doc,
  sequenceFrameRate,
  removeMarker,
  updateMarker,
} from "@/stores/project-store";
import { beginMarkerDrag } from "./interactions";
import { framesToTimecode } from "@/lib/timecode";
import type { Marker } from "@/model/doc";

export const MARKER_LANE_HEIGHT_PX = 16;

/**
 * Marker colours.
 *
 * Six is enough to mean something and few enough to remember. Named because
 * "the red ones are pickups" is how people actually use them.
 */
export const MARKER_COLORS = [
  { value: "#facc15", name: "Yellow" },
  { value: "#ef4444", name: "Red" },
  { value: "#22c55e", name: "Green" },
  { value: "#3b82f6", name: "Blue" },
  { value: "#a855f7", name: "Purple" },
  { value: "#f97316", name: "Orange" },
];

/**
 * The marker strip above the tracks.
 *
 * Markers live on the sequence rather than on a clip, so they belong in their
 * own lane rather than hanging off whatever happens to be underneath them —
 * moving a clip should not move a note about the edit.
 */
const MarkerLane: Component = () => {
  const [editing, setEditing] = createSignal<string | null>(null);
  const markers = createMemo(() => doc().markers);
  /**
   * Keyed by id, not by the marker object. Structural sharing means every edit
   * produces a new object, and `For` compares by reference — so iterating the
   * objects rebuilds the pin, and the editor popover's focused input with it,
   * on every keystroke.
   */
  const markerIds = createMemo(() => markers().map((m) => m.id));

  return (
    <div
      class="relative border-b border-border/60 bg-secondary/30"
      style={{ height: `${MARKER_LANE_HEIGHT_PX}px` }}
      data-marker-lane
    >
      <For each={markerIds()}>
        {(markerId) => (
          <Show when={markers().find((m) => m.id === markerId)}>
            {(marker) => (
              <MarkerPin
                marker={marker()}
                editing={editing() === markerId}
                onEdit={() => setEditing(markerId)}
                onDone={() => setEditing(null)}
              />
            )}
          </Show>
        )}
      </For>
    </div>
  );
};

const MarkerPin: Component<{
  marker: Marker;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}> = (props) => {
  const x = () => frameToContentX(timelineView(), props.marker.frame);

  const title = () =>
    [
      props.marker.name || "Marker",
      framesToTimecode(props.marker.frame, sequenceFrameRate()),
      props.marker.note,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <>
      <div
        class="absolute top-0 bottom-0 -translate-x-1/2 cursor-ew-resize flex items-center"
        style={{ left: `${x()}px` }}
        title={title()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          beginMarkerDrag(e, props.marker.id);
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          props.onEdit();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          props.onEdit();
        }}
      >
        {/* A pin, not a line: the line belongs to the playhead. */}
        <div
          class="w-2.5 h-2.5 rotate-45 border border-black/30"
          style={{ background: props.marker.color }}
        />
        <Show when={props.marker.name}>
          <span class="ml-1 text-[9px] leading-none text-foreground/80 whitespace-nowrap pointer-events-none">
            {props.marker.name}
          </span>
        </Show>
      </div>

      <Show when={props.editing}>
        <MarkerEditor marker={props.marker} onDone={props.onDone} />
      </Show>
    </>
  );
};

/** Name, note and colour for one marker. */
const MarkerEditor: Component<{ marker: Marker; onDone: () => void }> = (props) => {
  const x = () => frameToContentX(timelineView(), props.marker.frame);

  return (
    <div
      class="absolute z-30 top-full mt-1 w-56 rounded border border-border bg-card shadow-xl p-2 space-y-2"
      style={{ left: `${Math.max(0, x() - 20)}px` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="text"
        placeholder="Marker name"
        value={props.marker.name}
        autofocus
        onInput={(e) => updateMarker(props.marker.id, { name: e.currentTarget.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") props.onDone();
          e.stopPropagation();
        }}
        class="w-full px-1.5 py-1 text-xs bg-input border border-border rounded text-foreground"
      />
      <textarea
        placeholder="Note"
        rows={2}
        value={props.marker.note ?? ""}
        onInput={(e) => updateMarker(props.marker.id, { note: e.currentTarget.value })}
        onKeyDown={(e) => e.stopPropagation()}
        class="w-full px-1.5 py-1 text-[11px] bg-input border border-border rounded text-foreground resize-none"
      />
      <div class="flex items-center gap-1">
        <For each={MARKER_COLORS}>
          {(color) => (
            <button
              class="w-4 h-4 rounded-full border"
              classList={{
                "ring-2 ring-primary ring-offset-1 ring-offset-card":
                  props.marker.color === color.value,
              }}
              style={{ background: color.value, "border-color": "rgba(0,0,0,0.3)" }}
              title={color.name}
              onClick={() => updateMarker(props.marker.id, { color: color.value })}
            />
          )}
        </For>
        <button
          class="ml-auto text-[10px] text-destructive hover:text-destructive/80"
          onClick={() => {
            removeMarker(props.marker.id);
            props.onDone();
          }}
        >
          Delete
        </button>
      </div>
      <button
        class="w-full py-0.5 text-[10px] rounded bg-secondary hover:bg-accent text-foreground"
        onClick={props.onDone}
      >
        Done
      </button>
    </div>
  );
};

export default MarkerLane;
