/**
 * The performance budgets, and the harness that measures against them.
 *
 * Two of them, both from the plan: the scene builder must stay under 2 ms at
 * 1000 clips, and a preview frame must stay under a display frame at half
 * resolution. They are the two places where a regression is invisible in a
 * correctness test and obvious in use — a preview that has quietly started
 * costing 20 ms a frame still draws exactly the right picture.
 *
 * Three things make a timing assertion something other than a flaky test:
 *
 * - **The median, not the worst.** A single sample catches a garbage collection
 *   or a scheduler hiccup and calls it a regression.
 * - **The numbers are always printed**, pass or fail. A budget that only speaks
 *   up when it breaks tells you nothing about the run that was at 95% of it.
 * - **An allowance for the machine.** CI runners are slower than a laptop and
 *   have no GPU at all, so the browser budget there is measured against
 *   software rasterization. `VITE_PERF_ALLOWANCE` multiplies every budget; CI
 *   sets it, and it is deliberately the same knob for both suites so there is
 *   one place to look when a budget starts passing too easily.
 */

/** Milliseconds. */
export const BUDGET_MS = {
  /** `buildScene` on a 1000-clip document. */
  sceneBuild: 2,
  /** One full preview frame — scene, decode lookup, GL — at half resolution. */
  previewFrame: 1000 / 60,
} as const;

export interface Timing {
  median: number;
  p95: number;
  worst: number;
  runs: number;
}

/**
 * The multiplier applied to every budget on this machine.
 *
 * Read through `import.meta.env` rather than `process.env` so the same helper
 * works in the browser suite, where there is no `process`.
 */
export function allowance(): number {
  const raw = (import.meta.env?.VITE_PERF_ALLOWANCE ?? "") as string;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Runs `body` repeatedly, discarding a warm-up, and summarises the timings. */
export function measure(runs: number, body: (run: number) => void): Timing {
  // JIT warm-up and, in the browser case, the first-frame cost of allocating
  // textures. Measuring those would measure the harness.
  const warmUp = Math.max(3, Math.floor(runs / 10));
  for (let i = 0; i < warmUp; i++) body(i);

  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const startedAt = performance.now();
    body(i);
    samples.push(performance.now() - startedAt);
  }

  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))],
    worst: samples[samples.length - 1],
    runs,
  };
}

/** The budget as it applies here, and a line in the log saying how it went. */
export function budgetFor(label: string, budgetMs: number, timing: Timing): number {
  const budget = budgetMs * allowance();
  const percent = Math.round((timing.median / budget) * 100);
  // Printed on every run, not only on failure: a budget nobody reads until it
  // breaks gives no warning that it was about to.
  console.log(
    `[perf] ${label}: median ${timing.median.toFixed(3)} ms, ` +
      `p95 ${timing.p95.toFixed(3)} ms, worst ${timing.worst.toFixed(3)} ms ` +
      `— ${percent}% of a ${budget.toFixed(2)} ms budget over ${timing.runs} runs`,
  );
  return budget;
}
