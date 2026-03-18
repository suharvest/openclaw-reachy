import crypto from "node:crypto";
import type WebSocket from "ws";
import type { OutboundMessage } from "./protocol.js";
import { clearLastDeliveredText } from "./send.js";
import type { ConversationState } from "./state.js";

export type SessionEntry = {
  sessionId: string;
  ws: WebSocket;
  state: ConversationState;
  runId: string | null;
  abortController: AbortController | null;
  textBuffer: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  createdAt: number;
  lastActivityAt: number;
};

const sessions = new Map<string, SessionEntry>();

export function createSession(ws: WebSocket, requestedId?: string): SessionEntry {
  const sessionId = requestedId?.trim() || crypto.randomUUID();
  // Resume existing session if the client reconnects with the same id
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.ws = ws;
    existing.lastActivityAt = Date.now();
    return existing;
  }
  const entry: SessionEntry = {
    sessionId,
    ws,
    state: "idle",
    runId: null,
    abortController: null,
    textBuffer: "",
    history: [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  sessions.set(sessionId, entry);
  return entry;
}

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (entry?.abortController) {
    entry.abortController.abort("session_closed");
  }
  sessions.delete(sessionId);
  clearLastDeliveredText(sessionId);
  clearChildToParentMappings(sessionId);
}

/** Callback to clear subagent hook mappings; set by subagent-hooks.ts. */
let clearChildToParentMappings: (sessionId: string) => void = () => {};

/** Allow subagent-hooks to register its cleanup callback. */
export function onSessionRemoved(cb: (sessionId: string) => void): void {
  clearChildToParentMappings = cb;
}

export function listSessions(): SessionEntry[] {
  return [...sessions.values()];
}

export function sessionCount(): number {
  return sessions.size;
}

/** Send a typed outbound message to the session's websocket. */
export function wsSend(session: SessionEntry, msg: OutboundMessage): void {
  if (session.ws.readyState === session.ws.OPEN) {
    session.ws.send(JSON.stringify(msg));
  }
}

/** Abort the current agent run (if any) and reset run state. */
export function abortCurrentRun(session: SessionEntry, reason: string): void {
  const { abortController, runId } = session;
  if (abortController) {
    abortController.abort(reason);
  }
  if (runId) {
    wsSend(session, { type: "stream_abort", runId, reason });
  }
  session.abortController = null;
  session.runId = null;
  session.textBuffer = "";
}

/** Start a new run: create a fresh AbortController and runId. */
export function startRun(session: SessionEntry): { runId: string; abortSignal: AbortSignal } {
  const runId = crypto.randomUUID();
  const abortController = new AbortController();
  session.runId = runId;
  session.abortController = abortController;
  session.textBuffer = "";
  return { runId, abortSignal: abortController.signal };
}

// ── Idle timeout sweep ──────────────────────────────────────────────

let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic sweep that closes sessions exceeding `idleTimeoutMs`.
 * Call once at server startup; the timer is cleared by `stopIdleSweep()`.
 */
export function startIdleSweep(idleTimeoutMs: number, log?: { info: (msg: string) => void }): void {
  if (idleSweepTimer) return;
  const interval = Math.max(30_000, Math.floor(idleTimeoutMs / 4));
  idleSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
      if (now - entry.lastActivityAt > idleTimeoutMs) {
        log?.info(`[desktop-robot] session ${id} idle-timed-out after ${idleTimeoutMs}ms`);
        entry.ws.close(4003, "idle timeout");
        removeSession(id);
      }
    }
  }, interval);
  // Allow the process to exit even if the timer is still active.
  if (typeof idleSweepTimer === "object" && "unref" in idleSweepTimer) {
    idleSweepTimer.unref();
  }
}

export function stopIdleSweep(): void {
  if (idleSweepTimer) {
    clearInterval(idleSweepTimer);
    idleSweepTimer = null;
  }
}
