import { Component, Show, createSignal, onCleanup } from "solid-js";
import {
  type ExportSettings,
  type ExportProgress,
  DEFAULT_EXPORT_SETTINGS,
  exportTimeline,
  cancelExport,
  downloadBlob,
  getSupportedFormats,
} from "@/renderer/export-engine";
import { projectState } from "@/stores/project-store";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

const ExportDialog: Component<ExportDialogProps> = (props) => {
  const [settings, setSettings] = createSignal<ExportSettings>({
    ...DEFAULT_EXPORT_SETTINGS,
  });
  const [progress, setProgress] = createSignal<ExportProgress | null>(null);
  const [exporting, setExporting] = createSignal(false);

  const formats = getSupportedFormats();

  const updateSetting = <K extends keyof ExportSettings>(
    key: K,
    value: ExportSettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleExport = async () => {
    setExporting(true);
    setProgress(null);

    const blob = await exportTimeline(settings(), (p) => {
      setProgress({ ...p });
    });

    if (blob) {
      const ext = settings().format === "mp4" ? "mp4" : "webm";
      const name = `${projectState.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.${ext}`;
      downloadBlob(blob, name);
    }

    setExporting(false);
  };

  const handleCancel = () => {
    if (exporting()) {
      cancelExport();
    } else {
      props.onClose();
    }
  };

  const formatTime = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const phaseLabel = (): string => {
    const p = progress();
    if (!p) return "";
    switch (p.phase) {
      case "preparing":
        return "Preparing media...";
      case "rendering":
        return `Rendering frame ${p.currentFrame} / ${p.totalFrames}`;
      case "encoding":
        return "Finalizing...";
      case "complete":
        return "Export complete!";
      case "cancelled":
        return "Export cancelled";
      case "error":
        return `Error: ${p.error}`;
      default:
        return "";
    }
  };

  const isComplete = () => {
    const p = progress();
    return p?.phase === "complete" || p?.phase === "cancelled" || p?.phase === "error";
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="bg-card border border-border rounded-lg shadow-2xl w-[480px] max-h-[90vh] overflow-auto">
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 class="text-sm font-semibold text-foreground">Export Video</h2>
            <button
              class="text-muted-foreground hover:text-foreground text-lg leading-none"
              onClick={props.onClose}
              disabled={exporting() && !isComplete()}
            >
              ✕
            </button>
          </div>

          {/* Settings */}
          <Show when={!exporting()}>
            <div class="px-5 py-4 space-y-4">
              {/* Format */}
              <div>
                <label class="block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                  Format
                </label>
                <div class="flex gap-2">
                  {formats.map((f) => (
                    <button
                      class={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        settings().format === f.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : f.supported
                            ? "bg-secondary text-foreground border-border hover:bg-accent"
                            : "bg-secondary/50 text-muted-foreground/40 border-border/50 cursor-not-allowed"
                      }`}
                      onClick={() => {
                        if (f.supported) updateSetting("format", f.id as "webm" | "mp4");
                      }}
                      disabled={!f.supported}
                      title={f.supported ? f.label : `${f.label} (not supported)`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution */}
              <div>
                <label class="block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                  Resolution
                </label>
                <div class="flex gap-2">
                  {[
                    { w: 1920, h: 1080, label: "1080p" },
                    { w: 1280, h: 720, label: "720p" },
                    { w: 854, h: 480, label: "480p" },
                    { w: 3840, h: 2160, label: "4K" },
                  ].map((r) => (
                    <button
                      class={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        settings().width === r.w && settings().height === r.h
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-foreground border-border hover:bg-accent"
                      }`}
                      onClick={() => {
                        updateSetting("width", r.w);
                        updateSetting("height", r.h);
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div class="mt-1.5 text-[10px] text-muted-foreground">
                  {settings().width} × {settings().height}
                </div>
              </div>

              {/* Frame Rate */}
              <div>
                <label class="block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                  Frame Rate
                </label>
                <div class="flex gap-2">
                  {[24, 30, 60].map((fps) => (
                    <button
                      class={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        settings().fps === fps
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-foreground border-border hover:bg-accent"
                      }`}
                      onClick={() => updateSetting("fps", fps)}
                    >
                      {fps} fps
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Bitrate */}
              <div>
                <label class="block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
                  Video Quality
                </label>
                <div class="flex gap-2">
                  {[
                    { bps: 4_000_000, label: "Medium (4 Mbps)" },
                    { bps: 8_000_000, label: "High (8 Mbps)" },
                    { bps: 16_000_000, label: "Ultra (16 Mbps)" },
                  ].map((q) => (
                    <button
                      class={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        settings().videoBitrate === q.bps
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-foreground border-border hover:bg-accent"
                      }`}
                      onClick={() => updateSetting("videoBitrate", q.bps)}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Audio */}
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="include-audio"
                  checked={settings().includeAudio}
                  onChange={(e) =>
                    updateSetting("includeAudio", e.currentTarget.checked)
                  }
                  class="rounded border-border"
                />
                <label
                  for="include-audio"
                  class="text-xs text-foreground cursor-pointer"
                >
                  Include audio
                </label>
              </div>
            </div>
          </Show>

          {/* Progress */}
          <Show when={exporting()}>
            <div class="px-5 py-6 space-y-4">
              <div class="text-sm text-foreground font-medium">
                {phaseLabel()}
              </div>

              {/* Progress bar */}
              <div class="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  class={`h-full rounded-full transition-all duration-200 ${
                    progress()?.phase === "error"
                      ? "bg-destructive"
                      : progress()?.phase === "complete"
                        ? "bg-green-500"
                        : "bg-primary"
                  }`}
                  style={{ width: `${progress()?.percent ?? 0}%` }}
                />
              </div>

              {/* Stats */}
              <div class="flex justify-between text-[10px] text-muted-foreground">
                <span>{Math.round(progress()?.percent ?? 0)}%</span>
                <Show when={progress()?.phase === "rendering"}>
                  <span>
                    Elapsed: {formatTime(progress()?.elapsedMs ?? 0)} ·
                    Remaining: ~{formatTime(progress()?.estimatedRemainingMs ?? 0)}
                  </span>
                </Show>
              </div>
            </div>
          </Show>

          {/* Footer */}
          <div class="flex justify-end gap-2 px-5 py-3 border-t border-border">
            <Show when={!exporting() || isComplete()}>
              <button
                class="px-4 py-1.5 text-xs rounded bg-secondary text-foreground hover:bg-accent border border-border"
                onClick={props.onClose}
              >
                {isComplete() ? "Close" : "Cancel"}
              </button>
            </Show>
            <Show when={exporting() && !isComplete()}>
              <button
                class="px-4 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleCancel}
              >
                Cancel Export
              </button>
            </Show>
            <Show when={!exporting()}>
              <button
                class="px-4 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
                onClick={handleExport}
              >
                Export
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ExportDialog;
