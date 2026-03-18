import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setDesktopRobotRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getDesktopRobotRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("desktop-robot runtime not initialized");
  }
  return runtime;
}
