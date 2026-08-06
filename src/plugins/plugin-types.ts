import type { PanelDefinition } from "@/web-components/registry";

export interface ShaderEffect {
  id: string;
  name: string;
  category: string;
  vertexShader?: string;
  fragmentShader: string;
  uniforms: ShaderUniform[];
}

export interface ShaderUniform {
  name: string;
  type: "float" | "vec2" | "vec3" | "vec4" | "int" | "bool" | "sampler2D";
  default: number | number[] | boolean;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}

export interface PluginAPI {
  registerPanel(def: PanelDefinition): void;
  registerEffect(effect: ShaderEffect): void;
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
}

export interface VideOSPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  panels?: PanelDefinition[];
  effects?: ShaderEffect[];
  init(api: PluginAPI): void | Promise<void>;
  destroy?(): void;
}
