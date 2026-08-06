/**
 * Transition shaders for blending between clips.
 * Each transition takes two textures (A and B) and a progress value [0..1].
 */

import {
  createProgram,
  createFullscreenQuad,
  drawQuad,
  PASSTHROUGH_VERTEX,
} from "./gl-utils";

// ── Transition shader sources ───────────────────────────────────────

const CROSSFADE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_textureA;
uniform sampler2D u_textureB;
uniform float u_progress;
out vec4 fragColor;
void main() {
  vec4 a = texture(u_textureA, v_uv);
  vec4 b = texture(u_textureB, v_uv);
  fragColor = mix(a, b, u_progress);
}
`;

const DIP_TO_BLACK_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_textureA;
uniform sampler2D u_textureB;
uniform float u_progress;
out vec4 fragColor;
void main() {
  vec4 a = texture(u_textureA, v_uv);
  vec4 b = texture(u_textureB, v_uv);
  float fade = u_progress < 0.5
    ? 1.0 - u_progress * 2.0
    : (u_progress - 0.5) * 2.0;
  vec4 color = u_progress < 0.5 ? a : b;
  fragColor = vec4(color.rgb * fade, color.a);
}
`;

const WIPE_LEFT_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_textureA;
uniform sampler2D u_textureB;
uniform float u_progress;
out vec4 fragColor;
void main() {
  vec4 a = texture(u_textureA, v_uv);
  vec4 b = texture(u_textureB, v_uv);
  float edge = u_progress;
  float softness = 0.02;
  float t = smoothstep(edge - softness, edge + softness, v_uv.x);
  fragColor = mix(b, a, t);
}
`;

const WIPE_RIGHT_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_textureA;
uniform sampler2D u_textureB;
uniform float u_progress;
out vec4 fragColor;
void main() {
  vec4 a = texture(u_textureA, v_uv);
  vec4 b = texture(u_textureB, v_uv);
  float edge = 1.0 - u_progress;
  float softness = 0.02;
  float t = smoothstep(edge - softness, edge + softness, v_uv.x);
  fragColor = mix(a, b, t);
}
`;

// ── Transition types ────────────────────────────────────────────────

export type TransitionType = "crossfade" | "dip-to-black" | "wipe-left" | "wipe-right";

export interface TransitionDefinition {
  id: TransitionType;
  name: string;
  icon: string;
  fragmentSource: string;
}

export const TRANSITION_DEFINITIONS: TransitionDefinition[] = [
  {
    id: "crossfade",
    name: "Cross Fade",
    icon: "🔀",
    fragmentSource: CROSSFADE_FRAG,
  },
  {
    id: "dip-to-black",
    name: "Dip to Black",
    icon: "⬛",
    fragmentSource: DIP_TO_BLACK_FRAG,
  },
  {
    id: "wipe-left",
    name: "Wipe Left",
    icon: "◀",
    fragmentSource: WIPE_LEFT_FRAG,
  },
  {
    id: "wipe-right",
    name: "Wipe Right",
    icon: "▶",
    fragmentSource: WIPE_RIGHT_FRAG,
  },
];

// ── Compiled transition cache ───────────────────────────────────────

interface CompiledTransition {
  program: WebGLProgram;
  uTextureA: WebGLUniformLocation | null;
  uTextureB: WebGLUniformLocation | null;
  uProgress: WebGLUniformLocation | null;
}

const compiledPerContext = new WeakMap<
  WebGL2RenderingContext,
  {
    transitions: Map<string, CompiledTransition>;
    quadVAO: WebGLVertexArrayObject;
  }
>();

function getContextCache(gl: WebGL2RenderingContext) {
  let cache = compiledPerContext.get(gl);
  if (!cache) {
    cache = {
      transitions: new Map(),
      quadVAO: createFullscreenQuad(gl),
    };
    compiledPerContext.set(gl, cache);
  }
  return cache;
}

function getCompiledTransition(
  gl: WebGL2RenderingContext,
  type: TransitionType,
): CompiledTransition | null {
  const cache = getContextCache(gl);
  const cached = cache.transitions.get(type);
  if (cached) return cached;

  const def = TRANSITION_DEFINITIONS.find((d) => d.id === type);
  if (!def) return null;

  const program = createProgram(gl, PASSTHROUGH_VERTEX, def.fragmentSource);
  if (!program) return null;

  const compiled: CompiledTransition = {
    program,
    uTextureA: gl.getUniformLocation(program, "u_textureA"),
    uTextureB: gl.getUniformLocation(program, "u_textureB"),
    uProgress: gl.getUniformLocation(program, "u_progress"),
  };

  cache.transitions.set(type, compiled);
  return compiled;
}

/**
 * Render a transition between two textures.
 * @param gl - WebGL2 context
 * @param type - Transition type
 * @param textureA - Outgoing clip texture
 * @param textureB - Incoming clip texture
 * @param progress - Transition progress [0..1]
 * @param outputFBO - Framebuffer to render to (null = screen)
 */
export function renderTransition(
  gl: WebGL2RenderingContext,
  type: TransitionType,
  textureA: WebGLTexture,
  textureB: WebGLTexture,
  progress: number,
  outputFBO: WebGLFramebuffer | null = null,
): void {
  const compiled = getCompiledTransition(gl, type);
  if (!compiled) return;

  gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO);
  gl.useProgram(compiled.program);

  // Bind texture A to unit 0
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textureA);
  gl.uniform1i(compiled.uTextureA, 0);

  // Bind texture B to unit 1
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textureB);
  gl.uniform1i(compiled.uTextureB, 1);

  // Set progress
  gl.uniform1f(compiled.uProgress, progress);

  drawQuad(gl, getContextCache(gl).quadVAO);
}

/**
 * Dispose all compiled transition programs.
 */
export function disposeTransitions(gl: WebGL2RenderingContext): void {
  const cache = compiledPerContext.get(gl);
  if (cache) {
    for (const [, compiled] of cache.transitions) {
      gl.deleteProgram(compiled.program);
    }
    cache.transitions.clear();
    gl.deleteVertexArray(cache.quadVAO);
    compiledPerContext.delete(gl);
  }
}
