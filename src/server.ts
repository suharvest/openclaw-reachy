import { timingSafeEqual } from "node:crypto";
import crypto from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ResolvedDesktopRobotAccount } from "./accounts.js";
import type { CoreAgentDeps } from "./core-bridge.js";
import { loadCoreAgentDeps } from "./core-bridge.js";
import type { InboundMessage } from "./protocol.js";
import {
  abortCurrentRun,
  createSession,
  removeSession,
  sessionCount,
  startIdleSweep,
  startRun,
  stopIdleSweep,
  wsSend,
  type SessionEntry,
} from "./session.js";
import { transitionState } from "./state.js";
import { buildStreamCallbacks, flushStreamRelay } from "./stream-relay.js";

export type DesktopRobotServerOptions = {
  account: ResolvedDesktopRobotAccount;
  cfg: Record<string, unknown>;
  log?: { info: (msg: string) => void; warn: (msg: string) => void };
  abortSignal?: AbortSignal;
};

export type DesktopRobotServer = {
  httpServer: HttpServer;
  wss: WebSocketServer;
  stop: () => Promise<void>;
};

const DEFAULT_VOICE_PROMPT = `You are a voice assistant on a desktop robot. Your replies are spoken aloud via TTS.
Keep replies to 1-2 short sentences. Be conversational and natural.
If tools are available, only use them when the user's request clearly requires it.
For simple conversation, answer directly without tools.
Express your emotion by starting each reply with an emotion tag like [emotion:happy] or [emotion:thinking].
Available emotions: happy, sad, angry, surprised, thinking, confused, curious, excited, laugh, fear, neutral, listening, agreeing, disagreeing.
Use only one emotion tag per reply, placed at the very beginning.`;

export async function createDesktopRobotServer(
  opts: DesktopRobotServerOptions,
): Promise<DesktopRobotServer> {
  const { account, cfg, log } = opts;
  const { port, bind, path: wsPath } = account;
  const authToken = account.config.auth?.token?.trim();
  const allowAnonymous = account.config.auth?.allowAnonymous ?? false;
  const maxSessions = account.config.session?.maxSessions ?? 5;

  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("desktop-robot ok\n");
  });

  const wss = new WebSocketServer({ server: httpServer, path: wsPath });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // Auth check on upgrade (query param or header)
    if (authToken && !allowAnonymous) {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const qToken = url.searchParams.get("token");
      const hToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!safeTokenEqual(qToken, authToken) && !safeTokenEqual(hToken, authToken)) {
        ws.close(4001, "unauthorized");
        return;
      }
    }

    if (sessionCount() >= maxSessions) {
      ws.close(4002, "max sessions reached");
      return;
    }

    let session: SessionEntry | null = null;

    ws.on("message", (raw: Buffer | string) => {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as InboundMessage;
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
        return;
      }

      switch (msg.type) {
        case "hello":
          session = createSession(ws, msg.sessionId);
          wsSend(session, { type: "welcome", sessionId: session.sessionId });
          log?.info(`[desktop-robot] session ${session.sessionId} connected`);
          break;

        case "message":
          if (!session) {
            ws.send(JSON.stringify({ type: "error", message: "send hello first" }));
            return;
          }
          session.lastActivityAt = Date.now();
          handleUserMessage(session, msg.text, { account, cfg, log }).catch((err) => {
            log?.warn(`[desktop-robot] message handler error: ${err}`);
            if (session) wsSend(session, { type: "error", message: String(err) });
          });
          break;

        case "interrupt":
          if (!session) return;
          session.lastActivityAt = Date.now();
          handleInterrupt(session, log);
          break;

        case "state_change":
          if (!session) return;
          session.lastActivityAt = Date.now();
          handleStateChange(session, msg.state);
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong", ts: msg.ts }));
          break;

        case "robot_result":
          if (!session) return;
          session.lastActivityAt = Date.now();
          log?.info(
            `[desktop-robot] robot_result: ${msg.commandId} → ${JSON.stringify(msg.result).slice(0, 100)}`,
          );
          // Robot results are logged for now. When tool execution is fully
          // bridged, these will be fed back to the agent as tool results.
          break;

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              message: `unknown type: ${(msg as { type: string }).type}`,
            }),
          );
      }
    });

    ws.on("close", () => {
      if (session) {
        log?.info(`[desktop-robot] session ${session.sessionId} disconnected`);
        removeSession(session.sessionId);
        session = null;
      }
    });

    ws.on("error", (err) => {
      log?.warn(`[desktop-robot] ws error: ${err}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, bind, () => resolve());
    httpServer.on("error", reject);
  });

  log?.info(`[desktop-robot] WebSocket server listening on ws://${bind}:${port}${wsPath}`);

  const idleTimeoutMs = account.config.session?.idleTimeoutMs ?? 1_800_000;
  startIdleSweep(idleTimeoutMs, log);

  const stop = async () => {
    stopIdleSweep();
    for (const client of wss.clients) {
      client.close(1001, "server shutting down");
    }
    wss.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  if (opts.abortSignal) {
    opts.abortSignal.addEventListener("abort", () => void stop(), { once: true });
  }

  return { httpServer, wss, stop };
}

/** Constant-time token comparison to prevent timing attacks. */
function safeTokenEqual(input: string | null | undefined, expected: string): boolean {
  if (!input) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Message handlers ──────────────────────────────────────────────────

async function handleUserMessage(
  session: SessionEntry,
  text: string,
  ctx: {
    account: ResolvedDesktopRobotAccount;
    cfg: Record<string, unknown>;
    log?: { info: (msg: string) => void; warn: (msg: string) => void };
  },
): Promise<void> {
  // Transition to processing (force via idle as recovery if direct transition is invalid)
  const t = transitionState(session.state, "processing");
  if (!t.ok) {
    // e.g. speaking → processing: reset to idle first, then transition
    session.state = "idle";
    transitionState(session.state, "processing");
  }
  session.state = "processing";
  wsSend(session, { type: "state", state: "processing" });

  // Abort any in-flight run
  if (session.abortController) {
    abortCurrentRun(session, "new_message");
  }

  const { runId, abortSignal } = startRun(session);
  const callbacks = buildStreamCallbacks(session, runId, {
    minChunkChars: ctx.account.config.streaming?.minChunkChars,
  });

  // Record user turn
  session.history.push({ role: "user", text });

  let deps: CoreAgentDeps;
  try {
    deps = await loadCoreAgentDeps();
  } catch (err) {
    wsSend(session, { type: "error", message: `core bridge load failed: ${err}` });
    session.state = "idle";
    wsSend(session, { type: "state", state: "idle" });
    return;
  }

  const sessionId = session.sessionId;
  const agentId = ctx.account.config.agentId?.trim() || "desktop-robot";
  const agentDir = deps.resolveAgentDir(ctx.cfg, agentId);
  const workspaceDir = deps.resolveAgentWorkspaceDir(ctx.cfg, agentId);
  await deps.ensureAgentWorkspace({ dir: workspaceDir });
  const sessionFile = deps.resolveSessionFilePath(sessionId, null, { agentId });
  const timeoutMs = deps.resolveAgentTimeoutMs({ cfg: ctx.cfg });

  // Inject per-agent tool policy into agents.list[] so resolveEffectiveToolPolicy sees it.
  // Core reads config.agents.list (array of {id, tools, ...}), NOT config.agents[agentId].
  const allowedTools = ctx.account.config.tools ?? [];
  const existingAgents = (ctx.cfg as Record<string, unknown>).agents as
    | { list?: Array<Record<string, unknown>>; [k: string]: unknown }
    | undefined;
  const existingList: Array<Record<string, unknown>> = Array.isArray(existingAgents?.list)
    ? existingAgents!.list!
    : [];
  // Remove any existing entry for this agentId so we don't duplicate
  const filteredList = existingList.filter(
    (e) =>
      String(e.id ?? "")
        .trim()
        .toLowerCase() !== agentId.toLowerCase(),
  );
  // Only inject tool policy when explicit tools are configured.
  // An empty allowedTools means "use core defaults" — do NOT inject deny:["*"]
  // because some LLM providers (DashScope) reject empty tools arrays with 400.
  const cfgWithToolPolicy =
    allowedTools.length > 0
      ? {
          ...ctx.cfg,
          agents: {
            ...existingAgents,
            list: [
              ...filteredList,
              {
                id: agentId,
                tools: { allow: allowedTools },
              },
            ],
          },
        }
      : ctx.cfg;

  const extraSystemPrompt = ctx.account.config.responseSystemPrompt?.trim() || DEFAULT_VOICE_PROMPT;

  // Parse "provider/model" format (e.g. "minimax/MiniMax-M2.1")
  const rawModel = ctx.account.config.responseModel ?? undefined;
  let provider: string | undefined;
  let model: string | undefined;
  if (rawModel?.includes("/")) {
    const idx = rawModel.indexOf("/");
    provider = rawModel.slice(0, idx);
    model = rawModel.slice(idx + 1);
  } else {
    model = rawModel;
  }

  ctx.log?.info(
    `[desktop-robot] run: provider=${provider ?? "default"} model=${model ?? "default"} extraSystemPrompt=${extraSystemPrompt.length}chars`,
  );

  try {
    const result = await deps.runEmbeddedPiAgent({
      sessionId,
      sessionKey: `desktop-robot:${sessionId}`,
      agentId,
      messageProvider: "desktop-robot",
      messageChannel: "desktop-robot",
      agentAccountId: ctx.account.accountId,
      messageTo: `ws:${sessionId}`,
      sessionFile,
      workspaceDir,
      agentDir,
      config: cfgWithToolPolicy,
      prompt: text,
      provider,
      model,
      timeoutMs,
      runId,
      lane: "main",
      extraSystemPrompt,
      abortSignal,
      onAssistantMessageStart: callbacks.onAssistantMessageStart,
      onPartialReply: callbacks.onPartialReply,
      onBlockReply: callbacks.onBlockReply,
      onAgentEvent: callbacks.onAgentEvent,
    });

    flushStreamRelay(callbacks);

    const fullText =
      session.textBuffer ||
      result.payloads
        ?.filter((p) => !p.isError)
        .map((p) => p.text ?? "")
        .join("") ||
      "";

    // Record assistant turn
    if (fullText) {
      session.history.push({ role: "assistant", text: fullText });
    }

    if (result.meta?.aborted) {
      // Already sent stream_abort via abortCurrentRun
    } else {
      wsSend(session, { type: "stream_end", runId, fullText });
    }
  } catch (err) {
    flushStreamRelay(callbacks);
    const msg = err instanceof Error ? err.message : String(err);
    wsSend(session, { type: "stream_abort", runId, reason: msg });
  } finally {
    session.runId = null;
    session.abortController = null;
    session.textBuffer = "";

    // Transition to speaking (desktop will say it) or idle if nothing was generated
    const next = transitionState(session.state, "speaking");
    session.state = next.state;
    if (next.state === "speaking") {
      // Desktop will send state_change{speaking_done} when TTS finishes
    } else {
      wsSend(session, { type: "state", state: "idle" });
    }
  }
}

function handleInterrupt(
  session: SessionEntry,
  log?: { info: (msg: string) => void; warn: (msg: string) => void },
): void {
  log?.info(`[desktop-robot] interrupt in session ${session.sessionId}`);
  abortCurrentRun(session, "interrupt");
  const t = transitionState(session.state, "listening");
  session.state = t.state;
}

function handleStateChange(
  session: SessionEntry,
  clientState: "listening" | "idle" | "speaking_done",
): void {
  switch (clientState) {
    case "listening": {
      const t = transitionState(session.state, "listening");
      session.state = t.state;
      break;
    }
    case "speaking_done": {
      const t = transitionState(session.state, "idle");
      session.state = t.state;
      wsSend(session, { type: "state", state: "idle" });
      break;
    }
    case "idle": {
      const t = transitionState(session.state, "idle");
      session.state = t.state;
      wsSend(session, { type: "state", state: "idle" });
      break;
    }
  }
}
