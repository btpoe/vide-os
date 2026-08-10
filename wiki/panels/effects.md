# Effects

The effect library. Search it, filter it, and click an effect to add it to every
selected clip.

---

## Using it

1. Select one or more clips on the timeline.
2. Click an effect.

That is the whole interaction. Until something is selected the list is dimmed
and a note says _"Select a clip to apply effects."_ — the effects are visible so
you can browse them, but they are not clickable, because an effect with nothing
to apply to is not an action.

| Control        | What it does                                         |
| -------------- | ---------------------------------------------------- |
| Search box     | Filters by name                                      |
| Category pills | `All`, `Color`, `Keying`, `Blur`, `Stylize`          |
| An effect row  | Adds it, with default values, to every selected clip |

Adding an effect is one undo step per clip. Once added, everything else about it
— parameters, order, bypass, removal, keyframes — happens in
[Properties](properties.md).

---

## The eight effects

### Color

| Effect                  | Parameters                    | Notes                                                |
| ----------------------- | ----------------------------- | ---------------------------------------------------- |
| **Brightness/Contrast** | Brightness −1…1, Contrast 0…3 | Contrast pivots around mid-grey.                     |
| **Saturation**          | Saturation 0…3                | Rec. 709 luma weights. 0 is greyscale, 1 is neutral. |
| **Hue Rotate**          | Hue −180°…180°                | Rotates in HSV.                                      |

### Keying

| Effect         | Parameters                     | Notes                                                                                                                    |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Chroma Key** | Threshold 0…1, Smoothing 0…0.5 | Keys on RGB distance from the key colour. The key colour itself is fixed at pure green and is not yet exposed in the UI. |

### Blur

| Effect            | Parameters    | Notes                                                                                         |
| ----------------- | ------------- | --------------------------------------------------------------------------------------------- |
| **Gaussian Blur** | Radius 0…0.15 | **Separable** — two passes, horizontal then vertical. Radius is a fraction of frame _height_. |
| **Sharpen**       | Amount 0…2    | 5-tap unsharp kernel.                                                                         |

### Stylize

| Effect         | Parameters                  | Notes                                                      |
| -------------- | --------------------------- | ---------------------------------------------------------- |
| **Vignette**   | Intensity 0…2, Radius 0…1.5 | Darkens towards the corners.                               |
| **Film Grain** | Intensity 0…0.5             | Animated — driven by a time uniform the pipeline supplies. |

---

## Two things worth understanding

### Blur radius is resolution-independent

The radius is expressed as a **fraction of frame height**, not a pixel count.
A blur you set while previewing at half resolution is _the same blur_ in a
full-resolution export. The horizontal pass corrects for aspect ratio so the
result is round rather than stretched.

This matters more than it sounds. The previous implementation used pixel offsets
and ran only one horizontal pass — with the direction hidden from the UI and
defaulted to `[1, 0]`. Every "Gaussian blur" in the app was a one-dimensional
smear that changed strength with preview resolution.

### Effects run before the transform

The pipeline order per layer is fixed:

```
decode → crop → effects → transform + fit → opacity + blend
```

Effects therefore see undistorted pixels, and a rotation is not filtered twice.
Within the chain, the order of effects is yours to set — and it changes the
picture. Reorder with the ▲ / ▼ buttons in
[Properties](properties.md#effects).

---

## Limitations

- **Effects apply to video clips.** They are shaders; there is no audio effect
  chain. Per-clip volume, pan and fades are in
  [Properties ▸ Audio](properties.md#audio).
- **Vector parameters are not editable in the UI.** Only `float` uniforms get a
  row, which is why Chroma Key's key colour is fixed.
- **There is no effect preset system**, and no way to copy an effect chain
  between clips other than duplicating the clip.

Writing your own effect is a matter of adding one object with a fragment shader
to a registry — see
[Developer ▸ Effects and Transitions](../developer/effects-and-transitions.md).

Source: `src/panels/EffectsPanel.tsx`,
`src/renderer/effects-pipeline.ts`.

---

**See also:** [Properties](properties.md) ·
[Developer ▸ Effects and Transitions](../developer/effects-and-transitions.md)
