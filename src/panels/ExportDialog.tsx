import {
  Component,
  Show,
  For,
  createSignal,
  createResource,
  createMemo,
} from "solid-js";
import Overlay from "./Overlay";
import {
  exportTimeline,
  downloadBlob,
  exportFrameCount,
  ExportError,
  type ExportProgress,
} from "@/export/export-engine";
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_PRESETS,
  applyPreset,
  presetMatches,
  type ExportSettings,
} from "@/export/presets";
import { availableContainers, codecLabel } from "@/export/encoder";
import { doc } from "@/stores/project-store";
import { platform } from "@/platform";
import type { PositionedChunk } from "@/platform/types";
import { frameRateToNumber, framesToTimecode } from "@/lib/timecode";

/**
 * The export dialog.
 *
 * Two things it deliberately does not offer.
 *
 * **A frame rate.** The file gets the sequence's, shown here rather than
 * chosen. Offering 24/30/60 regardless of the timeline was an invitation to
 * pick a number that meant resampling, which nothing implemented.
 *
 * **A format that cannot be produced.** Both containers are probed with the
 * real encoder at the real resolution, and one with no usable codec is shown
 * disabled with the reason. The old dialog listed MP4 unconditionally and fell
 * back to WebM without saying so, producing a WebM file named `.mp4`.
 */

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

const QUALITIES = [
  { bps: 6_000_000, label: "Medium" },
  { bps: 12_000_000, label: "High" },
  { bps: 24_000_000, label: "Very high" },
];

const ExportDialog: Component<ExportDialogProps> = (props) => {
  const [settings, setSettings] = createSignal<ExportSettings>({
    ...DEFAULT_EXPORT_SETTINGS,
  });
  const [progress, setProgress] = createSignal<ExportProgress | null>(null);
  const [error, setError] = createSignal<{ message: string; remedy?: string } | null>(
    null,
  );
  const [exporting, setExporting] = createSignal(false);
  const [controller, setController] = createSignal<AbortController | null>(null);

  // Re-probed whenever the size or bitrate changes: a codec that encodes at
  // 1080p can fail at 4K on the same machine.
  const [containers] = createResource(
    () => ({
      width: settings().width,
      height: settings().height,
      videoBitrate: settings().videoBitrate,
      includeAudio: settings().includeAudio,
    }),
    () => availableContainers(settings()),
  );

  const update = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const rate = () => doc().sequence.frameRate;
  const totalFrames = createMemo(() => exportFrameCount(doc()));

  const chosen = () => containers()?.find((c) => c.container === settings().container);

  /**
   * @param toDisk Write straight to a file the user picks, rather than
   * building a `Blob` and downloading it. A long 4K export will not fit in
   * memory, so anything substantial should go this way.
   */
  const handleExport = async (toDisk: boolean) => {
    const abort = new AbortController();
    setError(null);

    let writable: WritableStream<PositionedChunk> | undefined;
    if (toDisk) {
      const extension = settings().container;
      // Picked before any work starts: the picker needs the user's click, and
      // asking after a five-minute render would be worse than useless.
      const ref = await platform.fs.pickSaveFile({
        suggestedName: `${doc().name}.${extension}`,
        accept: [{ description: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!ref) return;

      const stream = await platform.fs.createWritable?.(ref);
      if (!stream) {
        setError({
          message: "This browser cannot write directly to a file.",
          remedy: "Use Export instead; the file will download when it is done.",
        });
        return;
      }
      writable = stream;
    }

    setController(abort);
    setExporting(true);
    setProgress(null);

    try {
      const result = await exportTimeline({
        settings: settings(),
        doc: doc(),
        signal: abort.signal,
        onProgress: setProgress,
        writable,
      });
      if (result.blob) downloadBlob(result.blob, result.filename);
    } catch (thrown) {
      if (thrown instanceof ExportError) {
        setError({ message: thrown.message, remedy: thrown.remedy });
      } else {
        setError({ message: String(thrown) });
      }
    } finally {
      setExporting(false);
      setController(null);
    }
  };

  const formatTime = (ms: number): string => {
    const total = Math.round(ms / 1000);
    const minutes = Math.floor(total / 60);
    return `${minutes}:${(total % 60).toString().padStart(2, "0")}`;
  };

  const phaseLabel = (): string => {
    const current = progress();
    if (!current) return "Starting…";
    switch (current.phase) {
      case "preparing":
        return current.message ?? "Preparing";
      case "audio":
        return "Mixing audio";
      case "rendering":
        return `Rendering frame ${current.frame} of ${current.totalFrames}`;
      case "finalizing":
        return "Writing the file";
      case "complete":
        return "Done";
      case "cancelled":
        return "Cancelled";
      case "error":
        return "Failed";
    }
  };

  const done = () => progress()?.phase === "complete";

  return (
    <Show when={props.open}>
      <Overlay
        title="Export Video"
        onClose={props.onClose}
        width="w-[520px]"
        // A render in progress is writing to a file the user chose. Escape and
        // the backdrop are blocked with the ✕ rather than separately, so there
        // is no way out that abandons the write half-done — Cancel Export is
        // the one that stops it, and it says so.
        closeDisabled={exporting()}
      >
        <Show when={!exporting()}>
          <div class="px-5 py-4 space-y-4">
            <div>
              <label class="block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                Format
              </label>
              <div class="flex gap-2">
                <For each={containers() ?? []}>
                  {(container) => (
                    <button
                      class={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        settings().container === container.container
                          ? "bg-primary text-primary-foreground border-primary"
                          : container.available
                            ? "bg-secondary text-foreground border-border hover:bg-accent"
                            : "bg-secondary/50 text-muted-foreground/40 border-border/50 cursor-not-allowed"
                      }`}
                      disabled={!container.available}
                      title={container.reason}
                      onClick={() => update("container", container.container)}
                    >
                      {container.label}
                    </button>
                  )}
                </For>
                <Show when={containers.loading}>
                  <span class="text-[10px] text-muted-foreground self-center">
                    checking…
                  </span>
                </Show>
              </div>
              <Show when={chosen()}>
                {(container) => (
                  <div class="mt-1.5 text-[10px] text-muted-foreground">
                    {codecLabel(container().video)}
                    {settings().includeAudio
                      ? ` · ${codecLabel(container().audio)}`
                      : " · no audio"}
                    <Show when={container().reason}>
                      <span class="text-yellow-500"> — {container().reason}</span>
                    </Show>
                  </div>
                )}
              </Show>
            </div>

            <div>
              <label class="block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                Size
              </label>
              <div class="flex flex-wrap gap-2">
                <For each={EXPORT_PRESETS}>
                  {(preset) => (
                    <button
                      class={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        presetMatches(settings(), preset)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-foreground border-border hover:bg-accent"
                      }`}
                      title={preset.note}
                      onClick={() => setSettings(applyPreset(settings(), preset))}
                    >
                      {preset.label}
                    </button>
                  )}
                </For>
              </div>
              <div class="mt-1.5 text-[10px] text-muted-foreground">
                {settings().width} × {settings().height} ·{" "}
                {frameRateToNumber(rate()).toFixed(2)} fps · {totalFrames()} frames ·{" "}
                {framesToTimecode(totalFrames(), rate())}
              </div>
              <div class="mt-0.5 text-[10px] text-muted-foreground/60">
                The frame rate comes from the sequence, so the export matches the
                timeline exactly.
              </div>
            </div>

            <div>
              <label class="block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                Quality
              </label>
              <div class="flex gap-2">
                <For each={QUALITIES}>
                  {(quality) => (
                    <button
                      class={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        settings().videoBitrate === quality.bps
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-foreground border-border hover:bg-accent"
                      }`}
                      onClick={() => update("videoBitrate", quality.bps)}
                    >
                      {quality.label}
                    </button>
                  )}
                </For>
                <span class="text-[10px] text-muted-foreground self-center">
                  {(settings().videoBitrate / 1_000_000).toFixed(0)} Mbps
                </span>
              </div>
            </div>

            <label class="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={settings().includeAudio}
                onChange={(e) => update("includeAudio", e.currentTarget.checked)}
                class="accent-primary"
              />
              Include audio
            </label>

            <Show when={error()}>
              {(problem) => (
                <div class="rounded border border-destructive/50 bg-destructive/10 px-3 py-2">
                  <div class="text-xs text-destructive">{problem().message}</div>
                  <Show when={problem().remedy}>
                    <div class="text-[10px] text-muted-foreground mt-0.5">
                      {problem().remedy}
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>

        <Show when={exporting()}>
          <div class="px-5 py-6 space-y-4">
            <div class="text-sm text-foreground font-medium">{phaseLabel()}</div>
            <div class="w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                class={`h-full rounded-full transition-all duration-200 ${
                  done() ? "bg-green-500" : "bg-primary"
                }`}
                style={{ width: `${(progress()?.progress ?? 0) * 100}%` }}
              />
            </div>
            <div class="flex justify-between text-[10px] text-muted-foreground">
              <span>{Math.round((progress()?.progress ?? 0) * 100)}%</span>
              <Show when={progress()?.remainingMs != null}>
                <span>
                  Elapsed {formatTime(progress()?.elapsedMs ?? 0)} · about{" "}
                  {formatTime(progress()?.remainingMs ?? 0)} left
                </span>
              </Show>
            </div>
          </div>
        </Show>

        <div class="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <Show when={!exporting()}>
            <button
              class="px-4 py-1.5 text-xs rounded bg-secondary text-foreground hover:bg-accent border border-border"
              onClick={props.onClose}
            >
              Close
            </button>
            <button
              class="px-4 py-1.5 text-xs rounded bg-secondary text-foreground hover:bg-accent border border-border disabled:opacity-40"
              disabled={totalFrames() === 0 || !chosen()?.available}
              title="Write straight to disk. Necessary for anything too large to hold in memory."
              onClick={() => void handleExport(true)}
            >
              Save to File…
            </button>
            <button
              class="px-4 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium disabled:opacity-40"
              disabled={totalFrames() === 0 || !chosen()?.available}
              onClick={() => void handleExport(false)}
            >
              Export
            </button>
          </Show>
          <Show when={exporting()}>
            <button
              class="px-4 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => controller()?.abort()}
            >
              Cancel Export
            </button>
          </Show>
        </div>
      </Overlay>
    </Show>
  );
};

export default ExportDialog;
