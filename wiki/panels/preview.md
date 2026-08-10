# Preview

The program monitor: what the timeline looks like at the playhead, and the
transport that moves it.

---

## What it shows

A WebGL2 canvas presenting the composited frame at the current playhead
position, letterboxed to the sequence's aspect ratio. Everything you see here is
the same code path the exporter runs — the same scene builder, the same
compositor, the same effect and transition shaders — so **the exported file
cannot look different from the preview**.

Before the GL context is ready, the panel shows the sequence dimensions as
placeholder text.

## The transport

| Button | Action                | Shortcut |
| ------ | --------------------- | -------- |
| ⏮      | Go to start           | `Home`   |
| ⏪     | Shuttle back          | `J`      |
| ▶ / ⏸  | Play / pause          | `Space`  |
| ⏹      | Stop                  | `K`      |
| ⏩     | Shuttle forward       | `L`      |
| ⏭      | Go to end of content  | `End`    |
| ⛶      | Fullscreen the canvas | —        |

Plus a timecode readout of the playhead, in `HH:MM:SS:FF` at the sequence rate.

### J / K / L is real shuttle

Repeated presses step through a rate ladder rather than jumping a fixed
distance:

```
-4×   -2×   -1×   -0.5×   ⏸   0.5×   1×   2×   4×
```

`J` steps one rung towards the left, `L` one rung towards the right, and `K`
stops. Playing at 0.5× plays at half speed with audio; playing at -2× runs
backwards at double.

`←` and `→` step exactly one frame, by integer arithmetic on a frame index —
never by repeated float addition of `1/fps`.

### Where playback starts from

Wherever the playhead is. That sounds obvious, and it is the fix for a real bug:
eight different places in the UI move the playhead through the document store
without touching the clock, so pressing play used to resume from wherever the
clock was last anchored — usually frame zero.

The rule now: **while paused, the store's playhead is the authority; while
playing, the clock is.** Audio remains master during playback, which is the
entire point of the clock.

---

## Why the picture is correct

### One clock, derived from audio

The playback clock is derived from the `AudioContext`'s time, and it is audio
master **unconditionally** — even when the timeline has no audio at all. An
`AudioContext` is a monotonic, drift-free time source regardless of what is
connected to it, so making it unconditional removes an entire class of
two-clocks bug.

There is no per-frame audio sync step anywhere in the codebase. Every gain ramp
and voice start is scheduled at an absolute context time, so there is nothing to
correct.

### A paused frame is decoded on purpose

Preview rendering never blocks on a decode — it asks for whatever frame is
available and repeats the last one rather than stalling. That is right for
playback and wrong for a stationary playhead, which needs _something_ to
actually decode the frame you are parked on.

So a settled playhead triggers an asynchronous settle: the scheduler awaits
everything the scene asks for and then marks the preview dirty. A token guards
against a slow decode landing after you have scrubbed on and marking a stale
frame ready — a scrub is a stream of positions, not one.

### Which clips a frame needs comes from the scene

Not from "the clip at this frame on each track". Mid-transition both sides are
on screen and one of them is read from outside its own span, which a per-track
answer would miss.

---

## Adaptive quality

The preview renders at a **base size** derived from the panel's displayed size
and the sequence dimensions, and the scheduler runs a three-rung quality ladder
below it — 1/1, 1/2 and 1/4 of that base.

- The ladder drops a rung when frames cost too much, and climbs back with
  hysteresis in both directions.
- **Full quality is restored the moment the playhead settles**, because a paused
  frame has all the time it needs and is the one people actually look at.
- Only render _targets_ are scaled. The canvas buffer stays put, so a rung
  change never reallocates the drawing buffer; the final blit presents the
  smaller picture upscaled.

Two signals feed the decision: time spent inside the render call, and the
interval between rendered frames. **The second is the load-bearing one.**
Scaling render targets buys GPU fill rate, and GPU time is invisible to
`performance.now()` around a GL call — the calls return promptly and the next
animation frame simply arrives late instead.

A frame that lands in between the two thresholds is neither a strike nor a
credit. Counting a near-miss as credit is what walks a ladder up into a stutter
and straight back down, and that shimmer is what makes adaptive resolution read
as a rendering bug.

You can watch the ladder work: press `Shift+D` for the
[Debug HUD](dialogs.md#debug-hud), which shows the current rung, the render
time, the frame interval and the dropped-frame count.

---

## Notes and limitations

- **The preview canvas cannot be screenshotted from JavaScript.** The drawing
  buffer is created with `preserveDrawingBuffer: false` and is cleared as soon
  as the browser composites, so reading it from a later task returns black
  whatever was drawn. This has twice been mistaken for "the preview is not
  rendering". Tests read the composite framebuffer instead.
- Captions are **burned in** rather than overlaid (when burn-in is enabled), so
  the preview shows exactly what the exported file will contain.
- There is no safe-area or guide overlay yet.

Source: `src/panels/PreviewPanel.tsx`, `src/playback/scheduler.ts`,
`src/playback/preview-quality.ts`, `src/playback/clock.ts`,
`src/renderer/`.

---

**See also:** [Source monitor](source-monitor.md) · [Timeline](timeline.md) ·
[Debug HUD](dialogs.md#debug-hud)
