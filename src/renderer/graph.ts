/**
 * Drawing a `Scene`.
 *
 * Synchronous and pure GL. Everything it needs is already decided: the scene
 * carries evaluated numbers, and the frames it references are supplied by the
 * caller. Nothing here reads a store, waits on a decode, or interprets a
 * keyframe.
 *
 * Per layer, in this order:
 *
 * 1. **Source** — upload the frame, image, text raster or solid colour.
 * 2. **Crop** — folded into the source pass as a UV window, so it costs nothing.
 * 3. **Effects** — ping-pong at layer resolution, each target cleared first.
 * 4. **Transform and fit** — one quad draw with a matrix composing fit mode,
 *    anchor, scale, rotation and position. *After* effects, so effects see
 *    undistorted pixels and rotation is not filtered twice.
 * 5. **Opacity and blend** — composited into the accumulator.
 *
 * Blending is explicit in the shaders. Fixed-function blending is disabled,
 * because the composite shader already does alpha-over and letting the fixed
 * pipeline do it again applied it twice.
 */

import {
  createFramebuffer,
  createFullscreenQuad,
  createProgram,
  createTexture,
  drawQuad,
  uploadSolidColor,
  uploadTexture,
  PASSTHROUGH_VERTEX,
} from "./gl-utils";
import {
  applyEffects,
  createPipelineContext,
  disposeEffects,
  resizePipeline,
  type EffectInstance,
  type PipelineContext,
} from "./effects-pipeline";
import type { BlendMode } from "@/model/doc";
import type { Layer, Scene } from "./scene";
import { renderTransition, disposeTransitions } from "./transitions";

// ── Shaders ───────────────────────────────────────────────────────────

/**
 * Samples a source through a crop window and a transform matrix.
 *
 * The matrix maps destination UV back into source UV, so one draw does fit,
 * anchor, scale, rotation and position together — and the result is filtered
 * exactly once.
 */
const TRANSFORM_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
/** Inverse transform, destination UV -> source UV, row-major 3x3. */
uniform mat3 u_inverse;
/** Crop window in source UV: (left, bottom, right, top). */
uniform vec4 u_crop;
out vec4 fragColor;

void main() {
  vec3 mapped = u_inverse * vec3(v_uv, 1.0);
  vec2 uv = mapped.xy / mapped.z;

  // Outside the layer is transparent, not clamped: a rotated layer must show
  // what is behind it at the corners, not a smear of its edge pixels.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 cropped = mix(u_crop.xy, u_crop.zw, uv);
  fragColor = texture(u_texture, cropped);
}
`;

/**
 * Composites a layer over the accumulator.
 *
 * Alpha-over is written out rather than left to fixed-function blending, so
 * the blend mode can vary per layer and so it happens exactly once.
 */
const COMPOSITE_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform float u_opacity;
uniform int u_blend;
out vec4 fragColor;

vec3 blend(vec3 base, vec3 layer, int mode) {
  if (mode == 1) return base + layer;                 // add
  if (mode == 2) return 1.0 - (1.0 - base) * (1.0 - layer); // screen
  if (mode == 3) return base * layer;                 // multiply
  return layer;                                       // normal
}

void main() {
  vec4 base = texture(u_base, v_uv);
  vec4 layer = texture(u_layer, v_uv);
  float a = layer.a * u_opacity;

  vec3 blended = blend(base.rgb, layer.rgb, u_blend);
  float outA = a + base.a * (1.0 - a);
  vec3 outRGB = (blended * a + base.rgb * base.a * (1.0 - a)) / max(outA, 0.0001);
  fragColor = vec4(outRGB, outA);
}
`;

const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0,
  add: 1,
  screen: 2,
  multiply: 3,
};

// ── Transform maths ───────────────────────────────────────────────────

type Mat3 = Float32Array;

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Float32Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

function identity(): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

function translation(x: number, y: number): Mat3 {
  return new Float32Array([1, 0, x, 0, 1, y, 0, 0, 1]);
}

function scaling(x: number, y: number): Mat3 {
  return new Float32Array([x, 0, 0, 0, y, 0, 0, 0, 1]);
}

function rotationZ(degrees: number): Mat3 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return new Float32Array([c, -s, 0, s, c, 0, 0, 0, 1]);
}

function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return identity();
  const inv = 1 / det;
  return new Float32Array([
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ]);
}

/**
 * Scale factors that fit a source of one aspect into a destination of another.
 *
 * `contain` letterboxes, `cover` fills and crops, `fill` stretches, `none`
 * shows the source at its own size.
 */
function fitScale(
  fit: Layer["fit"],
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
): { x: number; y: number } {
  if (fit === "fill") return { x: 1, y: 1 };
  if (fit === "none") {
    return { x: sourceWidth / destWidth, y: sourceHeight / destHeight };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const destAspect = destWidth / destHeight;
  const wider = sourceAspect > destAspect;
  const shrink = fit === "contain" ? wider : !wider;

  return shrink
    ? { x: 1, y: destAspect / sourceAspect }
    : { x: sourceAspect / destAspect, y: 1 };
}

/**
 * Destination-UV to source-UV matrix for a layer.
 *
 * Built as the forward transform (anchor → scale → rotate → translate) and
 * then inverted, because writing the inverse directly is where sign errors
 * live.
 */
export function layerMatrix(
  layer: Layer,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
): Mat3 {
  const fit = fitScale(layer.fit, sourceWidth, sourceHeight, destWidth, destHeight);
  const t = layer.transform;

  // Work in a centred, aspect-corrected space so rotation is not sheared by a
  // non-square destination.
  const aspect = destWidth / destHeight;

  const forward = [
    // Move the anchor to the origin.
    translation(0.5 - t.anchorX, 0.5 - t.anchorY),
    translation(-0.5, -0.5),
    scaling(aspect, 1),
    rotationZ(t.rotation),
    scaling(1 / aspect, 1),
    scaling(fit.x * t.scaleX, fit.y * t.scaleY),
    // Position is a fraction of height, so vertical and horizontal moves of
    // the same number look the same distance.
    translation(t.x / aspect, t.y),
    translation(0.5, 0.5),
  ].reduce((acc, m) => multiply(m, acc), identity());

  return invert(forward);
}

// ── Graph context ─────────────────────────────────────────────────────

export interface GraphContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  quad: WebGLVertexArrayObject;
  transformProgram: WebGLProgram;
  compositeProgram: WebGLProgram;
  presentProgram: WebGLProgram;
  sourceTexture: WebGLTexture;
  /** Where the layer lands after transform, before compositing. */
  layerBuffer: { fbo: WebGLFramebuffer; texture: WebGLTexture };
  /** The accumulating picture. Two, because compositing reads and writes. */
  accumulators: [
    { fbo: WebGLFramebuffer; texture: WebGLTexture },
    { fbo: WebGLFramebuffer; texture: WebGLTexture },
  ];
  accumulatorIndex: 0 | 1;
  pipeline: PipelineContext;
  /** Scratch buffers for the two sides of a transition. */
  transitionBuffers: [
    { fbo: WebGLFramebuffer; texture: WebGLTexture },
    { fbo: WebGLFramebuffer; texture: WebGLTexture },
  ];
  disposed: boolean;
}

const PRESENT_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  // The canvas is opaque; show the composite over black rather than letting
  // the page show through where the picture is transparent.
  fragColor = vec4(c.rgb * c.a, 1.0);
}
`;

export function createGraph(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): GraphContext | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  // Every blend in this renderer is written out in a shader. Leaving
  // fixed-function blending on applied alpha-over a second time.
  gl.disable(gl.BLEND);

  const quad = createFullscreenQuad(gl);
  const sourceTexture = createTexture(gl);
  uploadSolidColor(gl, sourceTexture, 0, 0, 0, 0);

  return {
    gl,
    canvas,
    width,
    height,
    quad,
    transformProgram: createProgram(gl, PASSTHROUGH_VERTEX, TRANSFORM_FRAGMENT),
    compositeProgram: createProgram(gl, PASSTHROUGH_VERTEX, COMPOSITE_FRAGMENT),
    presentProgram: createProgram(gl, PASSTHROUGH_VERTEX, PRESENT_FRAGMENT),
    sourceTexture,
    layerBuffer: createFramebuffer(gl, width, height),
    accumulators: [
      createFramebuffer(gl, width, height),
      createFramebuffer(gl, width, height),
    ],
    accumulatorIndex: 0,
    pipeline: createPipelineContext(gl, quad, width, height),
    transitionBuffers: [
      createFramebuffer(gl, width, height),
      createFramebuffer(gl, width, height),
    ],
    disposed: false,
  };
}

export function resizeGraph(graph: GraphContext, width: number, height: number): void {
  const { gl } = graph;
  graph.width = width;
  graph.height = height;

  const buffers = [
    graph.layerBuffer,
    ...graph.accumulators,
    ...graph.transitionBuffers,
  ];
  for (const buffer of buffers) {
    gl.bindTexture(gl.TEXTURE_2D, buffer.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }
  resizePipeline(graph.pipeline, width, height);
}

export function disposeGraph(graph: GraphContext): void {
  if (graph.disposed) return;
  graph.disposed = true;
  disposeEffects(graph.gl);
  disposeTransitions(graph.gl);
}

// ── Drawing ───────────────────────────────────────────────────────────

/** A decoded source for a layer, supplied by the caller. */
export interface LayerImage {
  image: TexImageSource;
  width: number;
  height: number;
}

/** Resolves a layer's picture. Returning null skips the layer for this pass. */
export type ImageResolver = (layer: Layer) => LayerImage | null;

function clearTo(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null,
  width: number,
  height: number,
  alpha = 0,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, alpha);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * Renders one layer into `target`: source, crop, effects, then transform.
 *
 * Returns false when the layer has no picture yet, so the caller can leave the
 * accumulator untouched rather than compositing a hole over it.
 */
function renderLayer(
  graph: GraphContext,
  layer: Layer,
  resolve: ImageResolver,
  target: { fbo: WebGLFramebuffer; texture: WebGLTexture },
): boolean {
  const { gl, width, height } = graph;

  const picture = resolve(layer);
  if (!picture) return false;

  uploadTexture(gl, graph.sourceTexture, picture.image);

  // Effects run on the *untransformed* source, so a blur radius means the same
  // thing regardless of how the layer is scaled or rotated afterwards.
  let sourceTexture = graph.sourceTexture;
  if (layer.effects.length > 0) {
    const instances: EffectInstance[] = layer.effects.map((effect) => ({
      definitionId: effect.definitionId,
      values: effect.values,
    }));
    sourceTexture = applyEffects(graph.pipeline, sourceTexture, instances);
  }

  const inverse = layerMatrix(layer, picture.width, picture.height, width, height);

  clearTo(gl, target.fbo, width, height);
  gl.useProgram(graph.transformProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(gl.getUniformLocation(graph.transformProgram, "u_texture"), 0);
  gl.uniformMatrix3fv(
    gl.getUniformLocation(graph.transformProgram, "u_inverse"),
    // The matrix is built row-major; GL wants column-major, so transpose.
    true,
    inverse,
  );
  // Crop is expressed from each edge; the shader wants a UV window. Top and
  // bottom swap because texture v runs upward.
  gl.uniform4f(
    gl.getUniformLocation(graph.transformProgram, "u_crop"),
    layer.crop.left,
    layer.crop.bottom,
    1 - layer.crop.right,
    1 - layer.crop.top,
  );
  drawQuad(gl, graph.quad);
  return true;
}

/** Composites `layerTexture` over the current accumulator, flipping buffers. */
function compositeOver(
  graph: GraphContext,
  layerTexture: WebGLTexture,
  opacity: number,
  blend: BlendMode,
): void {
  const { gl, width, height } = graph;
  const source = graph.accumulators[graph.accumulatorIndex];
  const destination = graph.accumulators[graph.accumulatorIndex === 0 ? 1 : 0];

  gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fbo);
  gl.viewport(0, 0, width, height);
  gl.useProgram(graph.compositeProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source.texture);
  gl.uniform1i(gl.getUniformLocation(graph.compositeProgram, "u_base"), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, layerTexture);
  gl.uniform1i(gl.getUniformLocation(graph.compositeProgram, "u_layer"), 1);

  gl.uniform1f(gl.getUniformLocation(graph.compositeProgram, "u_opacity"), opacity);
  gl.uniform1i(
    gl.getUniformLocation(graph.compositeProgram, "u_blend"),
    BLEND_MODE_INDEX[blend],
  );

  drawQuad(gl, graph.quad);
  graph.accumulatorIndex = graph.accumulatorIndex === 0 ? 1 : 0;
}

/**
 * Draws a scene and presents it.
 *
 * Synchronous throughout: a layer whose frame is not decoded is skipped, never
 * waited for.
 *
 * Returns whether the presented picture is *this* frame's. False means nothing
 * the scene asked for was decoded yet and the previous picture is still on
 * screen, which the preview scheduler counts rather than mistaking for a draw.
 */
export function composeFrame(
  graph: GraphContext,
  scene: Scene,
  resolve: ImageResolver,
): boolean {
  if (graph.disposed) return false;
  const { gl, width, height } = graph;

  /**
   * Clears the accumulator, the first time something is ready to draw into it.
   *
   * Deferred rather than done up front, which is the whole fix: clearing before
   * resolving and then presenting whatever survived meant a frame the decoder
   * had not caught up with was presented as a hole — a black flash mid-playback,
   * every time. `renderLayer` returning false was supposed to "leave the
   * accumulator untouched", but untouched already meant cleared. Holding the
   * previous picture is what a late frame should look like: the picture is
   * late, not gone.
   */
  let drew = false;
  const beginComposite = (): void => {
    if (drew) return;
    drew = true;
    // Fully transparent; the present pass puts it over black.
    graph.accumulatorIndex = 0;
    clearTo(gl, graph.accumulators[0].fbo, width, height);
  };

  for (const node of scene.nodes) {
    if (node.kind === "layer") {
      if (renderLayer(graph, node.layer, resolve, graph.layerBuffer)) {
        beginComposite();
        compositeOver(
          graph,
          graph.layerBuffer.texture,
          node.layer.opacity,
          node.layer.blend,
        );
      }
      continue;
    }

    // A transition needs both sides rendered in full before it can blend them,
    // which is why it carries two layers rather than being a clip property.
    const [bufferA, bufferB] = graph.transitionBuffers;
    const hasFrom = renderLayer(graph, node.from, resolve, bufferA);
    const hasTo = renderLayer(graph, node.to, resolve, bufferB);

    if (hasFrom && hasTo) {
      beginComposite();
      clearTo(gl, graph.layerBuffer.fbo, width, height);
      gl.viewport(0, 0, width, height);
      renderTransition(
        gl,
        node.type,
        bufferA.texture,
        bufferB.texture,
        node.progress,
        graph.layerBuffer.fbo,
      );
      compositeOver(
        graph,
        graph.layerBuffer.texture,
        node.from.opacity,
        node.from.blend,
      );
    } else if (hasFrom || hasTo) {
      // One side undecoded: show whichever exists rather than dropping the
      // picture entirely mid-transition.
      const available = hasFrom ? bufferA : bufferB;
      const layer = hasFrom ? node.from : node.to;
      beginComposite();
      compositeOver(graph, available.texture, layer.opacity, layer.blend);
    }
  }

  // A scene with nothing in it — a gap in the timeline, or an empty project —
  // is legitimately black, and must clear rather than hold the last picture.
  // That is the one case "nothing drew" does not mean "not ready yet".
  const empty = scene.nodes.length === 0;
  if (empty && !drew) {
    graph.accumulatorIndex = 0;
    clearTo(gl, graph.accumulators[0].fbo, width, height);
  }

  present(graph);
  return drew || empty;
}

/** Blits the accumulator to the canvas. */
function present(graph: GraphContext): void {
  const { gl, canvas } = graph;
  const accumulator = graph.accumulators[graph.accumulatorIndex];

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(graph.presentProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, accumulator.texture);
  gl.uniform1i(gl.getUniformLocation(graph.presentProgram, "u_texture"), 0);
  drawQuad(gl, graph.quad);
}

/** The framebuffer holding the finished picture, for readback in tests. */
export function currentAccumulator(graph: GraphContext) {
  return graph.accumulators[graph.accumulatorIndex];
}
