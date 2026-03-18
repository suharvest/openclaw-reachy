import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { popLastDeliveredText } from "./send.js";
import { getSession, onSessionRemoved, wsSend } from "./session.js";

// Track spawned child → parent WS session so subagent_ended can route back.
const childToParentSession = new Map<string, string>();

/**
 * Register subagent lifecycle hooks so the desktop WS client receives
 * `task_spawned` and `task_completed` events when sessions_spawn is used.
 */
export function registerDesktopRobotSubagentHooks(api: OpenClawPluginApi) {
  // Clean up child→parent mappings when a session is removed.
  onSessionRemoved((sessionId) => {
    for (const [childKey, parentId] of childToParentSession) {
      if (parentId === sessionId) {
        childToParentSession.delete(childKey);
      }
    }
  });
  api.on("subagent_spawned", (event) => {
    const channel = event.requester?.channel?.trim().toLowerCase();
    if (channel !== "desktop-robot") return;

    // Extract sessionId from the messageTo field (format: "ws:<sessionId>")
    const to = event.requester?.to ?? "";
    const sessionId = to.startsWith("ws:") ? to.slice(3) : "";
    if (!sessionId) return;

    const session = getSession(sessionId);
    if (!session) return;

    // Remember the mapping for subagent_ended
    childToParentSession.set(event.childSessionKey, sessionId);

    wsSend(session, {
      type: "task_spawned",
      taskLabel: event.label ?? "background task",
      taskRunId: event.runId,
    });
  });

  api.on("subagent_ended", (event) => {
    const parentSessionId = childToParentSession.get(event.targetSessionKey);
    childToParentSession.delete(event.targetSessionKey);
    if (!parentSessionId) return;

    const session = getSession(parentSessionId);
    if (!session) return;

    const summary =
      event.outcome === "ok" ? "Task completed" : `Task ended: ${event.outcome ?? event.reason}`;

    // Grab the result text that was delivered via sendText just before this hook fired
    const fullText = popLastDeliveredText(parentSessionId);
    const MAX_PREVIEW = 200;
    const resultPreview = fullText
      ? fullText.length > MAX_PREVIEW
        ? fullText.slice(0, MAX_PREVIEW) + "…"
        : fullText
      : undefined;

    wsSend(session, {
      type: "task_completed",
      taskRunId: event.runId ?? "",
      summary,
      resultPreview,
    });
  });
}
