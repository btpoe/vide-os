/**
 * Shader-based effects pipeline.
 * Each effect is a fragment shader that processes a texture.
 * Effects are chained via ping-pong framebuffers.
 */

import { createProgram, createFramebuffer, drawQuad, FBO_VERTEX } from "./gl-utils";

// ── Effect definitions ──────────────────────────────────────────────

export interface EffectUniform {
  name: string;
  label: string;
  type: "float" | "vec2" | "vec3" | "vec4" | "int";
  default: number | number[];
  min?: number;
  max?: number;
  step?: number;
  hidden?: boolean; // hide from UI (e.g. u_time)
}

export interface EffectDefinition {
  id: string;
  name: string;
  category: string;
  fragmentSource: string;
  uniforms: EffectUniform[];
}

export interface EffectInstance {
  definitionId: string;
  values: Record<string, number | number[]>;
}

// ── Built-in effect shaders ─────────────────────────────────────────

const BRIGHTNESS_CONTRAST_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_brightness;
uniform float u_contrast;
out vec4 fragColor;
void main() {
  vec4 color = texture(u_texture, v_uv);
  color.rgb += u_brightness;
  color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}
`;

const SATURATION_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_saturation;
out vec4 fragColor;
void main() {
  vec4 color = texture(u_texture, v_uv);
  float gray = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  color.rgb = mix(vec3(gray), color.rgb, u_saturation);
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}
`;

const HUE_ROTATE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_hue;
out vec4 fragColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 color = texture(u_texture, v_uv);
  vec3 hsv = rgb2hsv(color.rgb);
  hsv.x = fract(hsv.x + u_hue / 360.0);
  color.rgb = hsv2rgb(hsv);
  fragColor = color;
}
`;

const CHROMA_KEY_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec3 u_keyColor;
uniform float u_threshold;
uniform float u_smoothing;
out vec4 fragColor;
void main() {
  vec4 color = texture(u_texture, v_uv);
  float dist = distance(color.rgb, u_keyColor);
  float alpha = smoothstep(u_threshold, u_threshold + u_smoothing, dist);
  fragColor = vec4(color.rgb, color.a * alpha);
}
`;

const GAUSSIAN_BLUR_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_radius;
uniform vec2 u_direction;
out vec4 fragColor;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (float i = -8.0; i <= 8.0; i += 1.0) {
    float weight = exp(-0.5 * (i * i) / (u_radius * u_radius + 0.001));
    vec2 offset = u_direction * i / u_resolution;
    sum += texture(u_texture, v_uv + offset) * weight;
    total += weight;
  }
  fragColor = sum / total;
}
`;

const VIGNETTE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_intensity;
uniform float u_radius;
out vec4 fragColor;
void main() {
  vec4 color = texture(u_texture, v_uv);
  float dist = distance(v_uv, vec2(0.5));
  float vignette = smoothstep(u_radius, u_radius - 0.2, dist);
  color.rgb *= mix(1.0, vignette, u_intensity);
  fragColor = color;
}
`;

const FILM_GRAIN_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_intensity;
uniform float u_time;
out vec4 fragColor;

float random(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 color = texture(u_texture, v_uv);
  float grain = random(v_uv + u_time) * 2.0 - 1.0;
  color.rgb += grain * u_intensity;
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}
`;

const SHARPEN_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_amount;
out vec4 fragColor;
void main() {
  vec2 texel = 1.0 / u_resolution;
  vec4 center = texture(u_texture, v_uv);
  vec4 top    = texture(u_texture, v_uv + vec2(0.0, texel.y));
  vec4 bottom = texture(u_texture, v_uv - vec2(0.0, texel.y));
  vec4 left   = texture(u_texture, v_uv - vec2(texel.x, 0.0));
  vec4 right  = texture(u_texture, v_uv + vec2(texel.x, 0.0));
  vec4 sharpened = center * (1.0 + 4.0 * u_amount) - (top + bottom + left + right) * u_amount;
  fragColor = vec4(clamp(sharpened.rgb, 0.0, 1.0), center.a);
}
`;

// ── Effect registry ─────────────────────────────────────────────────

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  {
    id: "brightness_contrast",
    name: "Brightness/Contrast",
    category: "Color",
    fragmentSource: BRIGHTNESS_CONTRAST_FRAG,
    uniforms: [
      {
        name: "u_brightness",
        label: "Brightness",
        type: "float",
        default: 0.0,
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        name: "u_contrast",
        label: "Contrast",
        type: "float",
        default: 1.0,
        min: 0,
        max: 3,
        step: 0.01,
      },
    ],
  },
  {
    id: "saturation",
    name: "Saturation",
    category: "Color",
    fragmentSource: SATURATION_FRAG,
    uniforms: [
      {
        name: "u_saturation",
        label: "Saturation",
        type: "float",
        default: 1.0,
        min: 0,
        max: 3,
        step: 0.01,
      },
    ],
  },
  {
    id: "hue_rotate",
    name: "Hue Rotate",
    category: "Color",
    fragmentSource: HUE_ROTATE_FRAG,
    uniforms: [
      {
        name: "u_hue",
        label: "Hue",
        type: "float",
        default: 0.0,
        min: -180,
        max: 180,
        step: 1,
      },
    ],
  },
  {
    id: "chroma_key",
    name: "Chroma Key",
    category: "Keying",
    fragmentSource: CHROMA_KEY_FRAG,
    uniforms: [
      {
        name: "u_keyColor",
        label: "Key Color",
        type: "vec3",
        default: [0.0, 1.0, 0.0],
        hidden: true,
      },
      {
        name: "u_threshold",
        label: "Threshold",
        type: "float",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        name: "u_smoothing",
        label: "Smoothing",
        type: "float",
        default: 0.1,
        min: 0,
        max: 0.5,
        step: 0.01,
      },
    ],
  },
  {
    id: "gaussian_blur",
    name: "Gaussian Blur",
    category: "Blur",
    fragmentSource: GAUSSIAN_BLUR_FRAG,
    uniforms: [
      {
        name: "u_radius",
        label: "Radius",
        type: "float",
        default: 3.0,
        min: 0,
        max: 20,
        step: 0.5,
      },
      {
        name: "u_direction",
        label: "Direction",
        type: "vec2",
        default: [1.0, 0.0],
        hidden: true,
      },
    ],
  },
  {
    id: "sharpen",
    name: "Sharpen",
    category: "Blur",
    fragmentSource: SHARPEN_FRAG,
    uniforms: [
      {
        name: "u_amount",
        label: "Amount",
        type: "float",
        default: 0.5,
        min: 0,
        max: 2,
        step: 0.01,
      },
    ],
  },
  {
    id: "vignette",
    name: "Vignette",
    category: "Stylize",
    fragmentSource: VIGNETTE_FRAG,
    uniforms: [
      {
        name: "u_intensity",
        label: "Intensity",
        type: "float",
        default: 0.5,
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        name: "u_radius",
        label: "Radius",
        type: "float",
        default: 0.75,
        min: 0,
        max: 1.5,
        step: 0.01,
      },
    ],
  },
  {
    id: "film_grain",
    name: "Film Grain",
    category: "Stylize",
    fragmentSource: FILM_GRAIN_FRAG,
    uniforms: [
      {
        name: "u_intensity",
        label: "Intensity",
        type: "float",
        default: 0.05,
        min: 0,
        max: 0.5,
        step: 0.005,
      },
      {
        name: "u_time",
        label: "Time",
        type: "float",
        default: 0.0,
        hidden: true,
      },
    ],
  },
];

// ── Compiled effect cache ───────────────────────────────────────────

interface CompiledEffect {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation | null>;
}

const compiledEffectsPerContext = new WeakMap<
  WebGL2RenderingContext,
  Map<string, CompiledEffect>
>();

function getCompiledEffect(
  gl: WebGL2RenderingContext,
  def: EffectDefinition,
): CompiledEffect {
  let compiledEffects = compiledEffectsPerContext.get(gl);
  if (!compiledEffects) {
    compiledEffects = new Map();
    compiledEffectsPerContext.set(gl, compiledEffects);
  }

  const cached = compiledEffects.get(def.id);
  if (cached) return cached;

  const program = createProgram(gl, FBO_VERTEX, def.fragmentSource);
  const uniformLocations = new Map<string, WebGLUniformLocation | null>();

  // Cache standard uniforms
  uniformLocations.set("u_texture", gl.getUniformLocation(program, "u_texture"));
  uniformLocations.set("u_resolution", gl.getUniformLocation(program, "u_resolution"));

  // Cache effect-specific uniforms
  for (const u of def.uniforms) {
    uniformLocations.set(u.name, gl.getUniformLocation(program, u.name));
  }

  const compiled: CompiledEffect = { program, uniformLocations };
  compiledEffects.set(def.id, compiled);
  return compiled;
}

// ── Pipeline execution ──────────────────────────────────────────────

export interface PipelineContext {
  gl: WebGL2RenderingContext;
  quad: WebGLVertexArrayObject;
  width: number;
  height: number;
  time: number;
  pingPong: [
    { fbo: WebGLFramebuffer; texture: WebGLTexture },
    { fbo: WebGLFramebuffer; texture: WebGLTexture },
  ];
}

/**
 * Create a pipeline context for effect processing.
 */
export function createPipelineContext(
  gl: WebGL2RenderingContext,
  quad: WebGLVertexArrayObject,
  width: number,
  height: number,
): PipelineContext {
  return {
    gl,
    quad,
    width,
    height,
    time: 0,
    pingPong: [
      createFramebuffer(gl, width, height),
      createFramebuffer(gl, width, height),
    ],
  };
}

/**
 * Resize the pipeline framebuffers.
 */
export function resizePipeline(
  ctx: PipelineContext,
  width: number,
  height: number,
): void {
  const { gl } = ctx;
  ctx.width = width;
  ctx.height = height;

  for (const pp of ctx.pingPong) {
    gl.bindTexture(gl.TEXTURE_2D, pp.texture);
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
}

/**
 * Apply a chain of effects to an input texture, writing to the output.
 * Returns the texture containing the final result.
 */
export function applyEffects(
  ctx: PipelineContext,
  inputTexture: WebGLTexture,
  effects: EffectInstance[],
): WebGLTexture {
  const { gl, quad, width, height } = ctx;

  if (effects.length === 0) return inputTexture;

  let readTexture = inputTexture;
  let writeIndex = 0;

  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i];
    const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.definitionId);
    if (!def) continue;

    const compiled = getCompiledEffect(gl, def);
    const isLast = i === effects.length - 1;

    // Bind write target
    if (isLast) {
      // Last effect writes to screen (or caller's framebuffer)
      // We still write to a ping-pong buffer so caller can composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.pingPong[writeIndex].fbo);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.pingPong[writeIndex].fbo);
    }

    gl.viewport(0, 0, width, height);
    gl.useProgram(compiled.program);

    // Bind input texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTexture);
    const texLoc = compiled.uniformLocations.get("u_texture");
    if (texLoc !== null && texLoc !== undefined) gl.uniform1i(texLoc, 0);

    // Set resolution
    const resLoc = compiled.uniformLocations.get("u_resolution");
    if (resLoc !== null && resLoc !== undefined) gl.uniform2f(resLoc, width, height);

    // Set effect uniforms
    for (const u of def.uniforms) {
      const loc = compiled.uniformLocations.get(u.name);
      if (loc === null || loc === undefined) continue;

      let value = effect.values[u.name] ?? u.default;

      // Special case: time uniform
      if (u.name === "u_time") value = ctx.time;

      if (u.type === "float") {
        gl.uniform1f(loc, value as number);
      } else if (u.type === "int") {
        gl.uniform1i(loc, value as number);
      } else if (u.type === "vec2") {
        const v = value as number[];
        gl.uniform2f(loc, v[0], v[1]);
      } else if (u.type === "vec3") {
        const v = value as number[];
        gl.uniform3f(loc, v[0], v[1], v[2]);
      } else if (u.type === "vec4") {
        const v = value as number[];
        gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      }
    }

    drawQuad(gl, quad);

    // Swap read/write
    readTexture = ctx.pingPong[writeIndex].texture;
    writeIndex = 1 - writeIndex;
  }

  return readTexture;
}

/**
 * Clean up compiled effect programs.
 */
export function disposeEffects(gl: WebGL2RenderingContext): void {
  const compiledEffects = compiledEffectsPerContext.get(gl);
  if (compiledEffects) {
    for (const [, compiled] of compiledEffects) {
      gl.deleteProgram(compiled.program);
    }
    compiledEffects.clear();
    compiledEffectsPerContext.delete(gl);
  }
}
