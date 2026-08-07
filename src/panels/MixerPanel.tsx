import { Component, For, createSignal, onCleanup, onMount } from "solid-js";
import { doc, applyEdit } from "@/stores/project-store";
import * as edits from "@/model/edits";
import { getAudioEngine } from "@/playback/transport";
import type { Track } from "@/model/doc";

/**
 * The mixer.
 *
 * Levels are read on an interval rather than per animation frame: meters only
 * need to look alive, and polling analysers at 60Hz for every track is wasted
 * work when the UI is otherwise idle.
 */
const METER_INTERVAL_MS = 50;

/** Converts a peak magnitude to a bar height, with a decibel-ish curve. */
function meterHeight(peak: number): number {
  if (peak <= 0) return 0;
  // -48dB floor, so quiet material still shows movement.
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(1, (db + 48) / 48));
}

const Meter: Component<{ level: number }> = (props) => (
  <div class="w-1.5 h-full bg-black/40 rounded-sm overflow-hidden flex flex-col justify-end">
    <div
      class="w-full transition-[height] duration-75"
      classList={{
        "bg-green-500": props.level < 0.85,
        "bg-amber-400": props.level >= 0.85 && props.level < 0.98,
        // Peaks at or near full scale are what clipping looks like.
        "bg-red-500": props.level >= 0.98,
      }}
      style={{ height: `${meterHeight(props.level) * 100}%` }}
    />
  </div>
);

const TrackStrip: Component<{ track: Track; level: number }> = (props) => {
  const anySolo = () => doc().tracks.some((t) => t.soloed);

  const toggle = (flag: "muted" | "soloed") =>
    applyEdit(
      `${props.track[flag] ? "Un" : ""}${flag === "muted" ? "mute" : "solo"} ${props.track.name}`,
      (d) => edits.setTrackFlag(d, props.track.id, flag, !props.track[flag]),
      { icon: flag === "muted" ? "🔇" : "🎧" },
    );

  return (
    <div class="flex flex-col items-center gap-1.5 px-2 py-2 border-r border-border min-w-[64px]">
      <span
        class="text-[10px] text-muted-foreground truncate max-w-[56px]"
        title={props.track.name}
      >
        {props.track.name}
      </span>

      <div class="flex gap-1 h-24">
        <Meter level={props.level} />
        <Meter level={props.level} />
      </div>

      <div class="flex gap-1">
        <button
          class="w-5 h-5 text-[9px] rounded"
          classList={{
            "bg-destructive text-white": props.track.muted,
            // A track silenced *by someone else's* solo reads differently from
            // one you muted yourself.
            "bg-secondary text-muted-foreground/40":
              !props.track.muted && anySolo() && !props.track.soloed,
            "bg-secondary text-muted-foreground hover:text-foreground":
              !props.track.muted && (!anySolo() || props.track.soloed),
          }}
          onClick={() => toggle("muted")}
          title="Mute"
        >
          M
        </button>
        <button
          class="w-5 h-5 text-[9px] rounded"
          classList={{
            "bg-amber-500 text-white": props.track.soloed,
            "bg-secondary text-muted-foreground hover:text-foreground":
              !props.track.soloed,
          }}
          onClick={() => toggle("soloed")}
          title="Solo"
        >
          S
        </button>
      </div>
    </div>
  );
};

const MixerPanel: Component = () => {
  const [levels, setLevels] = createSignal<{
    tracks: Map<string, number>;
    master: number;
  }>({
    tracks: new Map(),
    master: 0,
  });

  onMount(() => {
    const timer = setInterval(() => {
      const engine = getAudioEngine();
      if (!engine) return;
      setLevels(engine.levels());
    }, METER_INTERVAL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const audioTracks = () => doc().tracks.filter((t) => t.kind === "audio");
  const videoTracks = () => doc().tracks.filter((t) => t.kind === "video");

  return (
    <div class="h-full flex flex-col text-sm">
      <div class="px-2 py-1 border-b border-border text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
        Mixer
      </div>

      <div class="flex-1 flex overflow-x-auto">
        <For each={[...videoTracks(), ...audioTracks()]}>
          {(track) => (
            <TrackStrip track={track} level={levels().tracks.get(track.id) ?? 0} />
          )}
        </For>

        <div class="flex flex-col items-center gap-1.5 px-2 py-2 min-w-[64px] bg-secondary/30">
          <span class="text-[10px] text-foreground font-semibold">Master</span>
          <div class="flex gap-1 h-24">
            <Meter level={levels().master} />
            <Meter level={levels().master} />
          </div>
        </div>
      </div>

      <div class="px-2 py-1 border-t border-border text-[9px] text-muted-foreground">
        Meters show peak level during playback. Per-clip volume, pan and fades are in
        Properties.
      </div>
    </div>
  );
};

export default MixerPanel;
