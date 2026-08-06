/**
 * Multi-track compositor.
 * Layers video tracks from bottom to top with alpha blending.
 * Each clip's frame is uploaded as a texture, effects are applied,
 * then composited onto the output framebuffer.
 */

import {
  createProgram,
  createTexture,
  createFullscreenQuad,
  createFramebuffer,
  uploadTexture,
  uploadSolidColor,
  drawQuad,
  PASSTHROUGH_VERTEX,
  PASSTHROUGH_FRAGMENT,
} from "./gl-utils";
import {
  type PipelineContext,
  type EffectInstance,
  createPipelineContext,
  resizePipeline,
  applyEffects,
  disposeEffects,
  EFFECT_DEFINITIONS,
} from "./effects-pipeline";
import {
  type FrameSource,
  getCachedFrameSource,
  seekFrameSource,
  getFrameSource,
} from "./frame-source";
import {
  projectState,
  getEffectValueAtTime,
  type Clip,
  type Track,
} from "@/stores/project-store";
import { mediaState } from "@/stores/media-store";

// ── Compositing shader (blends layer on top of existing content) ────

const COMPOSITE_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec4 base = texture(u_base, v_uv);
  vec4 layer = texture(u_layer, v_uv);
  layer.a *= u_opacity;
  // Standard alpha-over compositing
  float outA = layer.a + base.a * (1.0 - layer.a);
  vec3 outRGB = (layer.rgb * layer.a + base.rgb * base.a * (1.0 - layer.a)) / max(outA, 0.001);
  fragColor = vec4(outRGB, outA);
}
`;

// ── Fit shader (scales source to fit output with letterboxing) ──────

const FIT_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_srcSize;
uniform vec2 u_dstSize;
out vec4 fragColor;
void main() {
  float srcAspect = u_srcSize.x / u_srcSize.y;
  float dstAspect = u_dstSize.x / u_dstSize.y;

  vec2 scale;
  if (srcAspect > dstAspect) {
    scale = vec2(1.0, dstAspect / srcAspect);
  } else {
    scale = vec2(srcAspect / dstAspect, 1.0);
  }

  vec2 uv = (v_uv - 0.5) / scale + 0.5;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    fragColor = texture(u_texture, uv);
  }
}
`;

export interface Compositor {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  quad: WebGLVertexArrayObject;
  passthroughProgram: WebGLProgram;
  compositeProgram: WebGLProgram;
  fitProgram: WebGLProgram;
  sourceTexture: WebGLTexture;
  compositeBuffer: { fbo: WebGLFramebuffer; texture: WebGLTexture };
  layerBuffer: { fbo: WebGLFramebuffer; texture: WebGLTexture };
  pipeline: PipelineContext;
  disposed: boolean;
}

/**
 * Initialize the compositor with a WebGL2 canvas.
 */
export function createCompositor(canvas: HTMLCanvasElement): Compositor | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    console.warn("WebGL2 not available for compositor");
    return null;
  }

  const width = projectState.width;
  const height = projectState.height;

  // Enable blending
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const quad = createFullscreenQuad(gl);
  const passthroughProgram = createProgram(
    gl,
    PASSTHROUGH_VERTEX,
    PASSTHROUGH_FRAGMENT,
  );
  const compositeProgram = createProgram(gl, PASSTHROUGH_VERTEX, COMPOSITE_FRAGMENT);
  const fitProgram = createProgram(gl, PASSTHROUGH_VERTEX, FIT_FRAGMENT);

  const sourceTexture = createTexture(gl);
  uploadSolidColor(gl, sourceTexture, 0, 0, 0);

  const compositeBuffer = createFramebuffer(gl, width, height);
  const layerBuffer = createFramebuffer(gl, width, height);
  const pipeline = createPipelineContext(gl, quad, width, height);

  return {
    gl,
    canvas,
    width,
    height,
    quad,
    passthroughProgram,
    compositeProgram,
    fitProgram,
    sourceTexture,
    compositeBuffer,
    layerBuffer,
    pipeline,
    disposed: false,
  };
}

/**
 * Resize the compositor output.
 */
export function resizeCompositor(
  comp: Compositor,
  width: number,
  height: number,
): void {
  const { gl } = comp;
  comp.width = width;
  comp.height = height;

  // Resize framebuffers
  for (const buf of [comp.compositeBuffer, comp.layerBuffer]) {
    gl.bindTexture(gl.TEXTURE_2D, buf.texture);
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

  resizePipeline(comp.pipeline, width, height);
}

/**
 * Render a single frame at the given time.
 * Composites all visible video tracks from bottom to top.
 */
export async function renderFrame(comp: Compositor, time: number): Promise<void> {
  if (comp.disposed) return;
  const { gl, width, height } = comp;

  comp.pipeline.time = time;

  // Clear composite buffer to black
  gl.bindFramebuffer(gl.FRAMEBUFFER, comp.compositeBuffer.fbo);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Get video tracks in bottom-to-top order (last track = bottom layer)
  const videoTracks = projectState.tracks
    .filter((t) => t.type === "video" && !t.muted)
    .reverse();

  for (const track of videoTracks) {
    const clip = getActiveClip(track, time);
    if (!clip) continue;

    const mediaEntry = mediaState.entries.find((e) => e.id === clip.mediaId);
    if (!mediaEntry) continue;

    // Get frame source
    const source = getCachedFrameSource(clip.mediaId);
    if (!source) {
      // Try to load it (async, will be available next frame)
      getFrameSource(mediaEntry).catch(() => {});
      continue;
    }

    // Calculate media time (accounting for in-point)
    const mediaTime = clip.inPoint + (time - clip.startTime);

    // Upload frame to texture
    await uploadFrameToTexture(comp, source, mediaTime);

    // Render source fitted to output resolution
    renderFittedLayer(comp, source);

    // Apply effects from clip data (with keyframe interpolation)
    const clipRelativeTime = time - clip.startTime;
    const effectInstances: EffectInstance[] = clip.effects.map((fx) => {
      const def = EFFECT_DEFINITIONS.find((d) => d.id === fx.definitionId);
      const values: Record<string, number | number[]> = { ...fx.values };
      // Override with keyframe-interpolated values
      if (def) {
        for (const u of def.uniforms) {
          if (u.type === "float" && fx.keyframes?.[u.name]?.length > 0) {
            values[u.name] = getEffectValueAtTime(
              fx,
              u.name,
              clipRelativeTime,
              (values[u.name] as number) ?? (u.default as number),
            );
          }
        }
      }
      return { definitionId: fx.definitionId, values };
    });
    let layerTexture = comp.layerBuffer.texture;

    if (effectInstances.length > 0) {
      layerTexture = applyEffects(comp.pipeline, layerTexture, effectInstances);
    }

    // Composite this layer onto the output
    compositeLayer(comp, layerTexture, 1.0);
  }

  // Blit composite to screen
  blitToScreen(comp);
}

/**
 * Render a black frame (for when nothing is visible).
 */
export function renderBlackFrame(comp: Compositor): void {
  if (comp.disposed) return;
  const { gl, canvas } = comp;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.08, 0.08, 0.08, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * Dispose the compositor and free all GL resources.
 */
export function disposeCompositor(comp: Compositor): void {
  if (comp.disposed) return;
  comp.disposed = true;
  const { gl } = comp;

  gl.deleteProgram(comp.passthroughProgram);
  gl.deleteProgram(comp.compositeProgram);
  gl.deleteProgram(comp.fitProgram);
  gl.deleteTexture(comp.sourceTexture);
  gl.deleteFramebuffer(comp.compositeBuffer.fbo);
  gl.deleteTexture(comp.compositeBuffer.texture);
  gl.deleteFramebuffer(comp.layerBuffer.fbo);
  gl.deleteTexture(comp.layerBuffer.texture);

  for (const pp of comp.pipeline.pingPong) {
    gl.deleteFramebuffer(pp.fbo);
    gl.deleteTexture(pp.texture);
  }

  disposeEffects(gl);
}

// ── Internal helpers ────────────────────────────────────────────────

function getActiveClip(track: Track, time: number): Clip | null {
  for (const clip of track.clips) {
    if (time >= clip.startTime && time < clip.startTime + clip.duration) {
      return clip;
    }
  }
  return null;
}

async function uploadFrameToTexture(
  comp: Compositor,
  source: FrameSource,
  mediaTime: number,
): Promise<void> {
  const { gl, sourceTexture } = comp;

  if (source.type === "video" && source.element) {
    const video = source.element as HTMLVideoElement;
    // Seek if needed
    await seekFrameSource(source, mediaTime);
    uploadTexture(gl, sourceTexture, video);
  } else if (source.type === "image" && source.element) {
    uploadTexture(gl, sourceTexture, source.element);
  } else {
    // Black frame
    uploadSolidColor(gl, sourceTexture, 0, 0, 0);
  }
}

function renderFittedLayer(comp: Compositor, source: FrameSource): void {
  const { gl, fitProgram, quad, sourceTexture, layerBuffer, width, height } = comp;

  gl.bindFramebuffer(gl.FRAMEBUFFER, layerBuffer.fbo);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(fitProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(gl.getUniformLocation(fitProgram, "u_texture"), 0);
  gl.uniform2f(
    gl.getUniformLocation(fitProgram, "u_srcSize"),
    source.width,
    source.height,
  );
  gl.uniform2f(gl.getUniformLocation(fitProgram, "u_dstSize"), width, height);

  drawQuad(gl, quad);
}

function compositeLayer(
  comp: Compositor,
  layerTexture: WebGLTexture,
  opacity: number,
): void {
  const { gl, compositeProgram, quad, compositeBuffer, width, height } = comp;

  // We need to read from compositeBuffer and write to it — use a temp copy
  // Actually, we read compositeBuffer.texture as base, layerTexture as layer,
  // and write to a temp. Then swap.
  // Pick whichever ping-pong buffer is NOT the layerTexture to avoid
  // overwriting effect output that hasn't been composited yet.
  const ppIndex = layerTexture === comp.pipeline.pingPong[0].texture ? 1 : 0;
  const tempFbo = comp.pipeline.pingPong[ppIndex].fbo;
  const tempTexture = comp.pipeline.pingPong[ppIndex].texture;

  // Copy current composite to temp
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, compositeBuffer.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, tempFbo);
  gl.blitFramebuffer(
    0,
    0,
    width,
    height,
    0,
    0,
    width,
    height,
    gl.COLOR_BUFFER_BIT,
    gl.NEAREST,
  );

  // Now composite: temp (base) + layer → compositeBuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, compositeBuffer.fbo);
  gl.viewport(0, 0, width, height);

  gl.useProgram(compositeProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tempTexture);
  gl.uniform1i(gl.getUniformLocation(compositeProgram, "u_base"), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, layerTexture);
  gl.uniform1i(gl.getUniformLocation(compositeProgram, "u_layer"), 1);

  gl.uniform1f(gl.getUniformLocation(compositeProgram, "u_opacity"), opacity);

  drawQuad(gl, quad);
}

function blitToScreen(comp: Compositor): void {
  const { gl, passthroughProgram, quad, compositeBuffer, canvas } = comp;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(passthroughProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, compositeBuffer.texture);
  gl.uniform1i(gl.getUniformLocation(passthroughProgram, "u_texture"), 0);
  gl.uniform1f(gl.getUniformLocation(passthroughProgram, "u_opacity"), 1.0);

  drawQuad(gl, quad);
}
