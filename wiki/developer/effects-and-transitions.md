# Effects and Transitions

Both are fragment shaders plus a small descriptor. Adding one is a matter of
appending an object to a registry — no wiring in the panel, no wiring in the
renderer.

---

## Effects

### The interface

```ts
// src/renderer/effects-pipeline.ts

export interface EffectUniform {
  /** The GLSL uniform name, e.g. "u_amount". */
  name: string;
  /** Shown in the Properties panel. */
  label: string;
  type: "float" | "vec2" | "vec3" | "vec4" | "int";
  default: number | number[];
  /** Slider bounds. Only `float` uniforms currently get a UI row. */
  min?: number;
  max?: number;
  step?: number;
  /** Hide from the UI — for values the pipeline supplies (u_time, u_direction). */
  hidden?: boolean;
}

export interface EffectDefinition {
  /** Stable — it is written into project files. */
  id: string;
  name: string;
  /** Becomes a filter pill in the Effects panel. */
  category: string;
  fragmentSource: string;
  uniforms: EffectUniform[];
  /**
   * Run twice, horizontally then vertically, with `u_direction` set by the
   * pipeline. A separable kernel is two O(n) passes instead of one O(n²).
   */
  separable?: boolean;
}

export const EFFECT_DEFINITIONS: EffectDefinition[];
```

### The shader contract

Every effect is a full-screen fragment shader over one input texture.

| Provided by the pipeline | Type        | Meaning                                          |
| ------------------------ | ----------- | ------------------------------------------------ |
| `v_uv`                   | `in vec2`   | Texture coordinates, 0…1                         |
| `u_texture`              | `sampler2D` | The input, always bound to unit 0                |
| `u_resolution`           | `vec2`      | Render target size in pixels, if you declare it  |
| `u_time`                 | `float`     | Seconds, if you declare a uniform with that name |
| `u_direction`            | `vec2`      | `[1,0]` then `[0,1]`, for `separable` effects    |

Write to `out vec4 fragColor`. WebGL2 / GLSL ES 3.00.

```glsl
#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_amount;
out vec4 fragColor;

void main() {
  vec4 color = texture(u_texture, v_uv);
  color.rgb = mix(color.rgb, 1.0 - color.rgb, u_amount);
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}
```

```ts
EFFECT_DEFINITIONS.push({
  id: "invert",
  name: "Invert",
  category: "Color",
  fragmentSource: INVERT_FRAG,
  uniforms: [
    {
      name: "u_amount",
      label: "Amount",
      type: "float",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
  ],
});
```

That is the whole integration. The Effects panel picks it up from the registry;
Properties builds a keyframable [`ParamRow`](../panels/properties.md#keyframes)
for each non-hidden `float` uniform; the pipeline compiles and caches the
program per GL context.

### Five rules that are not obvious

**1. Express spatial radii as a fraction of frame height, never in pixels.**

The preview renders at a lower resolution than the export. A pixel-based radius
means the blur you set while previewing is a _different blur_ in the exported
file. Correct for aspect on the horizontal axis so the result is round:

```glsl
vec2 aspect = vec2(u_resolution.y / u_resolution.x, 1.0);
vec2 offset = u_direction * t * u_radius * aspect;
```

**2. Mark separable kernels `separable: true` and honour `u_direction`.**

Declare it as a hidden `vec2` uniform. The pipeline runs your shader twice and
sets the direction; the user never sees it. Getting this wrong is not
theoretical — the built-in Gaussian blur shipped for months as a single
horizontal pass, because `u_direction` was declared, hidden, defaulted to
`[1,0]`, and never set by anything.

**3. Blending is disabled globally.** All compositing is explicit in-shader with
premultiplied alpha. Do not assume `gl.BLEND`; do not enable it.

**4. Cover the whole quad, or expect to be cleared.** Ping-pong targets are
cleared before each pass. That is insurance rather than a fix — every pass
currently draws a full-coverage quad — but it is what makes `discard` or a
partial draw safe.

**5. Effects run before the transform.**

```
decode → crop → effects → transform + fit → opacity + blend
```

Your shader sees undistorted source pixels. Do not try to compensate for a
rotation; it has not happened yet.

### Limitations

- Only `float` uniforms get a UI row. `vec3` colour pickers do not exist yet,
  which is why the built-in chroma key's colour is fixed.
- Effects are video-only. There is no audio effect chain.
- Programs are cached per GL context and never invalidated, so editing a shader
  needs a page reload rather than a hot update.

---

## Transitions

### The interface

```ts
// src/renderer/transitions.ts

export type TransitionType = "crossfade" | "dip-to-black" | "wipe-left" | "wipe-right";

export interface TransitionDefinition {
  id: TransitionType;
  name: string;
  /** Shown on the button in Properties. */
  icon: string;
  fragmentSource: string;
}

export const TRANSITION_DEFINITIONS: TransitionDefinition[];
```

Adding a transition type today means widening the `TransitionType` union in
**two** places — `src/renderer/transitions.ts` and `src/model/doc.ts` — because
the type is written into the project document and the document model owns its
own vocabulary. That is deliberate: a project file should not be able to
reference a transition the model has never heard of.

### The shader contract

| Provided     | Type        | Meaning                          |
| ------------ | ----------- | -------------------------------- |
| `v_uv`       | `in vec2`   | 0…1                              |
| `u_textureA` | `sampler2D` | The **outgoing** clip, on unit 0 |
| `u_textureB` | `sampler2D` | The **incoming** clip, on unit 1 |
| `u_progress` | `float`     | 0 at the start, 1 at the end     |

```glsl
#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_textureA;
uniform sampler2D u_textureB;
uniform float u_progress;
out vec4 fragColor;

void main() {
  float t = smoothstep(u_progress - 0.02, u_progress + 0.02, v_uv.y);
  fragColor = mix(texture(u_textureB, v_uv), texture(u_textureA, v_uv), t);
}
```

Both textures are **fully rendered sub-graphs** — each side has already had its
crop, effects, transform, opacity and blend applied. You are compositing two
finished pictures.

### Why transitions are edges

A transition is stored as `{ leftClipId, rightClipId, type, durationFrames }` on
the track — an **edge between two clips**, not a property of one.

Rendering needs both sides. Hanging a transition off the right-hand clip made
that relationship invisible to the compositor, which is why transitions were
stored, drawn in the timeline, and _never rendered at all_.

It also means a transition is **refused** when the material does not exist:
without a clip butted against this one and spare frames on both sides to overlap
into, there is nothing to transition between, and the UI says so rather than
faking it.

---

## Testing a shader

The render tier renders in **real WebGL2** and probes named pixels:

> "the pixel above the plate is transparent before the blur, and lit after it"

There is deliberately **no golden-image diffing**. Reference images would have to
be regenerated on every GPU and driver the suite runs on, whereas a named probe
survives that and reads as an assertion about the feature. `pixelmatch` and
`pngjs` were removed for exactly this reason.

Two traps when writing one:

- **Read the composite framebuffer, not the canvas.** The context is created
  with `preserveDrawingBuffer: false`, so the default drawing buffer is cleared
  as soon as the browser composites; reading it from a later task returns black
  whatever was drawn. This has twice been mistaken for a rendering bug.
- **Y-flip happens exactly once**, at texture upload, via
  `UNPACK_FLIP_Y_WEBGL`. Do not add another one in a vertex shader. Baked-in
  flips are what made alternating layers render upside down with two or more
  video tracks.

See `test/browser/render-graph.test.ts` for the shape.

Source: [`src/renderer/effects-pipeline.ts`](../../src/renderer/effects-pipeline.ts),
[`src/renderer/transitions.ts`](../../src/renderer/transitions.ts),
[`src/renderer/graph.ts`](../../src/renderer/graph.ts),
[`src/renderer/scene.ts`](../../src/renderer/scene.ts).

---

**See also:** [Effects panel](../panels/effects.md) ·
[Properties panel](../panels/properties.md)
