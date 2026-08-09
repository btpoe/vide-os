import { Component, For, Show, createSignal } from "solid-js";
import { loadDocument } from "@/stores/project-store";
import {
  readRevision,
  clearRevisions,
  type RecoveryOffer,
  type Revision,
} from "@/lib/autosave";

/**
 * Offered after a crash, and only then.
 *
 * A normal reload silently restores the last autosave, because that is what
 * anyone would expect and prompting every launch trains people to dismiss the
 * dialog without reading it. This one appears when the previous session did
 * not close cleanly, and its job is to let you go *further back* than the
 * newest autosave — which is what you want when the state that crashed the
 * editor is the state it saved.
 */

interface RecoveryDialogProps {
  offer: RecoveryOffer;
  onClose: () => void;
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleString();
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;
}

const RecoveryDialog: Component<RecoveryDialogProps> = (props) => {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const restore = async (revision: Revision) => {
    setBusy(true);
    setError(null);
    const doc = await readRevision(revision.key);
    setBusy(false);

    if (!doc) {
      setError("That version could not be read. Try an earlier one.");
      return;
    }
    loadDocument(doc);
    props.onClose();
  };

  const discard = async () => {
    setBusy(true);
    await clearRevisions();
    setBusy(false);
    props.onClose();
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="bg-card border border-border rounded-lg shadow-2xl w-[460px] max-h-[80vh] flex flex-col">
        <div class="px-5 py-3 border-b border-border">
          <h2 class="text-sm font-semibold text-foreground">
            The editor closed unexpectedly
          </h2>
          <p class="mt-1 text-[11px] text-muted-foreground">
            Your work was saved as it went. The most recent version is already open —
            pick an earlier one if that is not the one you want.
          </p>
        </div>

        <div class="flex-1 overflow-auto">
          <For each={props.offer.all}>
            {(revision, index) => (
              <button
                class="w-full flex items-center gap-2 px-4 py-2 text-left border-b border-border/40 hover:bg-accent/40 disabled:opacity-50"
                disabled={busy()}
                onClick={() => void restore(revision)}
              >
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-foreground truncate">
                    {revision.projectName || "Untitled Project"}
                    <Show when={index() === 0}>
                      <span class="ml-1.5 text-[9px] text-primary">newest</span>
                    </Show>
                  </div>
                  <div class="text-[10px] text-muted-foreground">
                    {ago(revision.savedAt)} · {size(revision.bytes)}
                  </div>
                </div>
                <span class="text-[10px] text-muted-foreground">Restore</span>
              </button>
            )}
          </For>
        </div>

        <Show when={error()}>
          {(message) => (
            <div class="px-5 py-2 text-[11px] text-destructive border-t border-border">
              {message()}
            </div>
          )}
        </Show>

        <div class="flex justify-between gap-2 px-5 py-3 border-t border-border">
          <button
            class="px-3 py-1.5 text-xs rounded text-destructive hover:bg-destructive/10 disabled:opacity-50"
            disabled={busy()}
            onClick={() => void discard()}
            title="Delete every autosaved version"
          >
            Discard all
          </button>
          <button
            class="px-4 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            onClick={props.onClose}
          >
            Keep the newest
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecoveryDialog;
