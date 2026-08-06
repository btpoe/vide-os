import type { VideOSPlugin, PluginAPI, ShaderEffect } from "./plugin-types";
import { registerPanel, unregisterPanel, type PanelDefinition } from "@/web-components/registry";

const loadedPlugins = new Map<string, VideOSPlugin>();
const eventHandlers = new Map<string, Set<Function>>();

function createPluginAPI(): PluginAPI {
  return {
    registerPanel(def: PanelDefinition) {
      registerPanel(def);
    },
    registerEffect(_effect: ShaderEffect) {
      // Will be wired to shader manager in Phase 4
      console.log("[plugin] registerEffect:", _effect.id);
    },
    on(event: string, handler: Function) {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)!.add(handler);
    },
    off(event: string, handler: Function) {
      eventHandlers.get(event)?.delete(handler);
    },
  };
}

export async function loadPlugin(urlOrModule: string | VideOSPlugin): Promise<void> {
  let plugin: VideOSPlugin;

  if (typeof urlOrModule === "string") {
    const module = await import(/* @vite-ignore */ urlOrModule);
    plugin = module.default || module;
  } else {
    plugin = urlOrModule;
  }

  if (loadedPlugins.has(plugin.id)) {
    console.warn(`[plugin] Plugin "${plugin.id}" is already loaded.`);
    return;
  }

  const api = createPluginAPI();
  await plugin.init(api);
  loadedPlugins.set(plugin.id, plugin);
  console.log(`[plugin] Loaded: ${plugin.name} v${plugin.version}`);
}

export function unloadPlugin(pluginId: string): void {
  const plugin = loadedPlugins.get(pluginId);
  if (!plugin) return;

  plugin.destroy?.();

  // Unregister any panels the plugin registered
  if (plugin.panels) {
    plugin.panels.forEach((p) => unregisterPanel(p.id));
  }

  loadedPlugins.delete(pluginId);
  console.log(`[plugin] Unloaded: ${plugin.name}`);
}

export function getLoadedPlugins(): VideOSPlugin[] {
  return Array.from(loadedPlugins.values());
}

export function emitPluginEvent(event: string, data?: unknown): void {
  const handlers = eventHandlers.get(event);
  if (handlers) {
    handlers.forEach((handler) => handler(data));
  }
}
