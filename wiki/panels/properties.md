# Properties

Everything about the selected clip. Every numeric value here can be keyframed
with the same three controls.

Select exactly **one** clip. With none or several selected, the panel says so
rather than showing a form that would edit something ambiguous.

---

## Sections

The panel shows only the sections that apply. A title clip gets **Text**; an
audio clip gets **Audio** but not **Transform**; a video clip with no audio
track in its source gets no **Audio** section.

| Section       | Applies to          |
| ------------- | ------------------- |
| Clip Info     | everything          |
| Speed         | everything          |
| Transform     | video clips         |
| Crop          | video clips         |
| Compositing   | video clips         |
| Text          | title clips         |
| Audio         | anything with audio |
| Transition In | video clips         |
| Effects       | everything          |

---

## Clip Info

Read-only. Name, track, start, duration, in point — all as timecode — and the
source resolution where the asset reports one.

## Speed

A slider and a numeric field from 0.25× to 4×, plus presets at 0.25, 0.5, 1, 2
and 4.

Retiming changes how much source the clip consumes: a 2× clip covering 30
timeline frames reads 60 source frames. The readout below shows the resulting
timeline duration.

> **The audio is pitched.** A slowed clip sounds lower, and the panel says so
> beneath the presets. Web Audio's `playbackRate` resamples and offers no
> `preservesPitch` on a buffer source — keeping pitch needs a time-stretcher,
> which is not built. There is deliberately no checkbox, because a checkbox that
> does nothing is worse than the honest sentence. See the
> [Roadmap](../roadmap.md).

## Transform

| Parameter    | Range      | Units                                                    |
| ------------ | ---------- | -------------------------------------------------------- |
| Position X/Y | −2…2       | Fractions of **frame height**, so resolution-independent |
| Scale X/Y    | 0…4        | Multipliers                                              |
| Rotation     | −360°…360° | Degrees, clockwise                                       |
| Opacity      | 0…100%     |                                                          |
| Anchor X/Y   | 0…1        | Origin for rotation and scale, within the layer          |

**Anchor is not animatable.** It defines what position, scale and rotation are
_relative to_; animating the origin of a rotation is a way to confuse yourself,
and no creator-tier editor offers it. It gets two plain number fields rather
than a keyframable row.

## Crop

Left, Right, Top and Bottom, as percentages of the source frame. Cropping
happens in source UV space and is folded into the upload pass, before effects.

## Compositing

| Control     | Options                               | Notes                                    |
| ----------- | ------------------------------------- | ---------------------------------------- |
| **Blend**   | `normal`, `add`, `screen`, `multiply` | Explicit in-shader, premultiplied alpha  |
| **Fit**     | `contain`, `cover`, `fill`, `none`    | How the source fits the sequence frame   |
| **Visible** | checkbox                              | Unchecking dims the clip on the timeline |

## Text

Only for title clips (created with the **Text** tool, `X`).

Text content, font size (12–200 px), colour, weight (normal / bold) and
alignment (left / center / right).

A title rasterises to an offscreen canvas keyed by its content and then enters
the render graph as an ordinary layer — which is how it inherits transform,
opacity, crop, effects and keyframes for free.

## Audio

| Control                       | Range                            | Notes                                                         |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------- |
| **Volume**                    | 0…200%                           | Keyframable                                                   |
| **Pan**                       | −1 (hard left) … +1 (hard right) | Keyframable                                                   |
| **Fade in**                   | 0 … half the clip                | Seconds, applied at the clip's own edge                       |
| **Fade out**                  | 0 … half the clip                |                                                               |
| **Include this clip's audio** | checkbox                         | Video clips only, and only when the source has an audio track |

That last checkbox replaced something worth knowing about: video clips used to
get an automatically created _duplicate_ audio clip. That duplicate is why every
export mixed every clip's audio twice, at double amplitude. It is now a
`linkedAudio` flag on the clip itself.

Automation is written as absolute-time ramps on the clip's gain node, scheduled
against the `AudioContext`'s own clock — which is why sync is exact by
construction and there is no per-frame audio correction anywhere.

## Transition In

Four buttons: **Cross Fade**, **Dip to Black**, **Wipe Left**, **Wipe Right**.
Click one to add a transition arriving into this clip; click the active one
again to remove it. A duration slider from 0.1 s to 2 s appears once one exists.

A transition is an **edge between two clips**, not a property of one. It needs:

- a clip butted directly against this one, and
- spare frames on **both** sides to overlap into.

Without those, the transition is **refused** rather than faked, and the panel
explains why. A transition faked from material that does not exist is a freeze
frame with a crossfade over it.

## Effects

Every effect on the clip, as a card:

| Control  | What it does                                                      |
| -------- | ----------------------------------------------------------------- |
| ▾ / ▸    | Expand or collapse the parameters                                 |
| Checkbox | Bypass. A bypassed effect is struck through and stays in place.   |
| ▲ / ▼    | Move earlier or later in the chain — **this changes the picture** |
| ✕        | Remove                                                            |

Add effects from the [Effects](effects.md) panel. Only `float` parameters get a
row; hidden and vector uniforms (a chroma key colour, a blur's pass direction)
are managed by the pipeline.

---

## Keyframes

Every parameter row in this panel — a transform axis, a crop edge, opacity,
volume, pan, an effect uniform — is the same thing: a number with optional
keyframes. So they all share one row, and they all get the full set of controls.

```
⏱  ◆  Opacity   [────────●───]  [ 75 ]
      ◀ 3 keys ▶                    ✕
      ┌──────────────────────────────┐
      │   ◆        ◆    ┃      ◆     │   ← strip, spanning the clip
      └──────────────────────────────┘
      [linear] [ease] [hold]
```

| Control                  | What it does                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **⏱ stopwatch**          | Turns animation on and off for this parameter                                                                 |
| **◇ / ◆ diamond**        | Adds or removes a keyframe at the playhead. Filled = there is one here.                                       |
| **◀ n keys ▶**           | Jump to the previous / next keyframe. Click the count to hide the strip.                                      |
| **✕**                    | Remove every keyframe on this parameter                                                                       |
| **Strip**                | Spans the **clip**, not the timeline. Click to seek; click a diamond to jump to it. Red line is the playhead. |
| **linear / ease / hold** | Easing for the keyframe under the playhead                                                                    |

Three behaviours are deliberate and worth knowing:

- **The stopwatch and the diamond are separate.** Conflating them is how a
  parameter ends up marked as animated with no keyframes behind it.
- **Setting a value while a parameter is animated writes a keyframe.** If it
  changed the base value instead, nothing would move on screen, because the keys
  win.
- **Switching animation off freezes the value at the playhead** rather than
  reverting to the base value. Turning off the stopwatch should not move the
  picture.

Keyframe times are **clip-relative**, which is why the strip spans the clip. Move
a clip and its animation moves with it.

---

Source: `src/panels/properties/PropertiesPanel.tsx`,
`src/panels/properties/ParamRow.tsx`, `src/model/edits.ts`,
`src/lib/animation.ts`.

---

**See also:** [Effects](effects.md) · [Mixer](mixer.md) · [Timeline](timeline.md)
