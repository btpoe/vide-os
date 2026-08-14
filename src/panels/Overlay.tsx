/**
 * The modal overlay the app's own dialogs are built from.
 *
 * There were three copies of this — the shortcut sheet, About, and the notes
 * from opening an older project — and all three were a `div` with a click
 * handler. That is dismissable with a mouse and with nothing else: no role, so
 * a screen reader announced nothing; no Escape, so the only way out was to find
 * the ✕; and focus stayed behind the backdrop on whatever had it before, which
 * is how a keyboard user ends up typing into a panel they cannot see.
 *
 * One component, so the next dialog gets all of it by construction.
 */

import { Component, JSX, onCleanup, onMount } from "solid-js";

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const Overlay: Component<{
  title: string;
  onClose: () => void;
  /** Wider than the default for content that needs it. */
  width?: string;
  /** Hides the heading bar for dialogs that draw their own — About does. */
  bare?: boolean;
  /**
   * Blocks every way out at once — Escape, the backdrop, and the ✕, which is
   * disabled rather than left looking available.
   *
   * One flag for all three because they are one decision: the export dialog
   * must not be dismissed while it is writing a file, and a dialog that ignores
   * Escape but still offers a close button is the kind of control that lies.
   */
  closeDisabled?: boolean;
  children: JSX.Element;
}> = (props) => {
  let dialogRef: HTMLDivElement | undefined;
  const titleId = `overlay-${props.title.replace(/\W+/g, "-").toLowerCase()}`;

  onMount(() => {
    // Restored on close, so dismissing a dialog puts the caret back where the
    // person left it rather than at the top of the document.
    const previous = document.activeElement as HTMLElement | null;
    dialogRef?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    onCleanup(() => previous?.focus?.());
  });

  const close = () => {
    if (!props.closeDisabled) props.onClose();
  };

  /** Escape closes; Tab cycles inside rather than escaping behind the backdrop. */
  const onKeyDown = (event: KeyboardEvent) => {
    // Nothing behind a modal should act on a keystroke: the shortcut handler is
    // a bubble-phase listener on the window, so stopping here is what keeps
    // Space from playing the timeline underneath an open dialog. Typing into a
    // field is unaffected — the handler ignores text entry either way.
    event.stopPropagation();

    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef) return;

    const focusable = [...dialogRef.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !dialogRef.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        class={`bg-card border border-border rounded-lg shadow-2xl max-h-[80vh] overflow-auto ${
          props.width ?? "w-[480px]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {props.bare ? (
          <h2 id={titleId} class="sr-only">
            {props.title}
          </h2>
        ) : (
          <div class="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-card">
            <h2 id={titleId} class="text-sm font-semibold">
              {props.title}
            </h2>
            <button
              class="text-muted-foreground hover:text-foreground disabled:opacity-30"
              aria-label={`Close ${props.title}`}
              disabled={props.closeDisabled}
              onClick={close}
            >
              ✕
            </button>
          </div>
        )}
        {props.children}
      </div>
    </div>
  );
};

export default Overlay;
