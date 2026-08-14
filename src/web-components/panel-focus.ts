/**
 * Moving focus between panel regions, for the F6 commands.
 *
 * Deliberately separate from `ve-panel-layout.ts`, and deliberately structural
 * rather than typed against `VePanelLayout`: importing the element class into
 * the command registry evaluates a module whose first statement extends
 * `HTMLElement`, which takes every unit test in Node down with it. The registry
 * has to stay loadable without a DOM — it is what the shortcut sheet is
 * generated from.
 *
 * The layout element is found rather than passed. This is a whole-window
 * action with no natural caller to hold a reference, and threading one down
 * from `App` would make it the only command in the registry that needed
 * arranging for.
 */

interface PanelFocusTarget {
  focusAdjacentPanel(delta: 1 | -1): boolean;
}

/** Returns false when there is no layout to move within. */
export function focusAdjacentPanel(delta: 1 | -1): boolean {
  if (typeof document === "undefined") return false;
  const layout = document.querySelector(
    "ve-panel-layout",
  ) as unknown as PanelFocusTarget | null;
  return layout?.focusAdjacentPanel?.(delta) ?? false;
}
