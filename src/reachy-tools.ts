import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { loadSkillTools, type ParsedTool } from "./skill-parser.js";

/**
 * Convert parsed SKILL.md tools into AnyAgentTool objects and register them
 * via the plugin API. Tool execute() returns a forwarding result — actual
 * robot_command dispatch happens in stream-relay.ts which intercepts reachy_*
 * tool events and sends them over WebSocket.
 */
export function registerReachyTools(api: OpenClawPluginApi, extensionDir: string): void {
  const parsed = loadSkillTools(extensionDir);
  if (parsed.length === 0) return;

  for (const def of parsed) {
    const tool = buildAgentTool(def);
    api.registerTool(tool, { optional: true });
  }
}

function buildAgentTool(def: ParsedTool): AnyAgentTool {
  return {
    name: def.name,
    label: def.name.replace(/_/g, " "),
    description: def.description,
    parameters: def.parameters,
    async execute(_toolCallId, params) {
      // The actual robot_command is forwarded by stream-relay.ts when it
      // sees a reachy_* tool_start event. This execute() just returns a
      // confirmation so the LLM knows the command was dispatched.
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              forwarded: true,
              action: def.name.replace(/^reachy_/, ""),
              params,
            }),
          },
        ],
        details: { forwarded: true },
      };
    },
  } as AnyAgentTool;
}
