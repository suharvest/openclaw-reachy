import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { desktopRobotPlugin } from "./src/channel.js";
import { registerReachyTools } from "./src/reachy-tools.js";
import { setDesktopRobotRuntime } from "./src/runtime.js";
import { registerDesktopRobotSubagentHooks } from "./src/subagent-hooks.js";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

const plugin = {
  id: "desktop-robot",
  name: "Reachy",
  description: "WebSocket channel for Reachy robots with emotion, voice, and hardware control",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setDesktopRobotRuntime(api.runtime);
    api.registerChannel({ plugin: desktopRobotPlugin as ChannelPlugin });
    registerDesktopRobotSubagentHooks(api);
    registerReachyTools(api, extensionDir);
  },
};

export default plugin;
