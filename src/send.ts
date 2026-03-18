import { getSession, wsSend } from "./session.js";

/**
 * Buffer of the last delivered text per session, keyed by sessionId.
 * Used by subagent-hooks to attach a resultPreview to task_completed.
 */
const lastDeliveredText = new Map<string, string>();

/** Get and clear the last delivered text for a session. */
export function popLastDeliveredText(sessionId: string): string | undefined {
  const text = lastDeliveredText.get(sessionId);
  lastDeliveredText.delete(sessionId);
  return text;
}

/** Remove buffered text for a session (called on session teardown). */
export function clearLastDeliveredText(sessionId: string): void {
  lastDeliveredText.delete(sessionId);
}

/**
 * Outbound send adapter — delivers a text message to a desktop-robot session.
 * The `to` parameter is the sessionId.
 */
export async function sendDesktopRobotMessage(
  to: string,
  text: string,
): Promise<{ ok: boolean; error?: string; runId?: string }> {
  // Strip "ws:" prefix if present (set by messageTo routing from sub-agents)
  const sessionId = to.startsWith("ws:") ? to.slice(3) : to;
  const session = getSession(sessionId);
  if (!session) {
    return { ok: false, error: `no active session: ${to}` };
  }
  // Buffer for task_completed resultPreview
  lastDeliveredText.set(sessionId, text);

  // Send as a complete (non-streaming) message — wrap in stream_start/end.
  const runId = `send-${Date.now()}`;
  wsSend(session, { type: "stream_start", runId });
  wsSend(session, { type: "stream_delta", text, runId });
  wsSend(session, { type: "stream_end", runId, fullText: text });
  return { ok: true, runId };
}
