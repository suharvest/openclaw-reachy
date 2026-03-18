import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDesktopRobotSubagentHooks } from "./subagent-hooks.js";

// Mock session module — getSession and wsSend are the observable side effects.
const sessionMocks = vi.hoisted(() => ({
  getSession: vi.fn((_id: string) => null as unknown),
  wsSend: vi.fn(),
}));

vi.mock("./session.js", () => ({
  getSession: sessionMocks.getSession,
  wsSend: sessionMocks.wsSend,
  onSessionRemoved: vi.fn(),
}));

// ── helpers ──────────────────────────────────────────────────────────

function registerHandlers() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const api = {
    config: {},
    on: (hookName: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers.set(hookName, handler);
    },
  } as unknown as OpenClawPluginApi;
  registerDesktopRobotSubagentHooks(api);
  return handlers;
}

function getRequiredHandler(
  handlers: Map<string, (event: unknown, ctx: unknown) => unknown>,
  hookName: string,
) {
  const handler = handlers.get(hookName);
  if (!handler) throw new Error(`expected ${hookName} hook handler`);
  return handler;
}

type FakeSession = { sessionId: string; ws: { readyState: number; OPEN: number } };

function makeFakeSession(id: string): FakeSession {
  return { sessionId: id, ws: { readyState: 1, OPEN: 1 } };
}

function createSpawnedEvent(overrides?: {
  runId?: string;
  childSessionKey?: string;
  agentId?: string;
  label?: string;
  mode?: string;
  requester?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string;
  };
  threadRequested?: boolean;
}) {
  const base = {
    runId: "run-abc",
    childSessionKey: "agent:default:subagent:child-1",
    agentId: "default",
    label: "web search",
    mode: "run" as const,
    requester: {
      channel: "desktop-robot",
      accountId: "default",
      to: "ws:sess-123",
    },
    threadRequested: false,
  };
  return {
    ...base,
    ...overrides,
    requester: { ...base.requester, ...(overrides?.requester ?? {}) },
  };
}

function createEndedEvent(overrides?: {
  targetSessionKey?: string;
  targetKind?: string;
  reason?: string;
  outcome?: string;
  runId?: string;
  accountId?: string;
}) {
  return {
    targetSessionKey: "agent:default:subagent:child-1",
    targetKind: "subagent",
    reason: "subagent-complete",
    outcome: "ok",
    runId: "run-abc",
    accountId: "default",
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────

describe("desktop-robot subagent hooks", () => {
  beforeEach(() => {
    sessionMocks.getSession.mockReset();
    sessionMocks.wsSend.mockReset();
  });

  it("registers subagent_spawned and subagent_ended hooks", () => {
    const handlers = registerHandlers();
    expect(handlers.has("subagent_spawned")).toBe(true);
    expect(handlers.has("subagent_ended")).toBe(true);
  });

  // ── subagent_spawned ─────────────────────────────────────────────

  it("sends task_spawned to the WS session on subagent_spawned", () => {
    const session = makeFakeSession("sess-123");
    sessionMocks.getSession.mockReturnValueOnce(session);

    const handlers = registerHandlers();
    const handler = getRequiredHandler(handlers, "subagent_spawned");
    handler(createSpawnedEvent(), {});

    expect(sessionMocks.getSession).toHaveBeenCalledWith("sess-123");
    expect(sessionMocks.wsSend).toHaveBeenCalledTimes(1);
    expect(sessionMocks.wsSend).toHaveBeenCalledWith(session, {
      type: "task_spawned",
      taskLabel: "web search",
      taskRunId: "run-abc",
    });
  });

  it("uses fallback label when event.label is undefined", () => {
    const session = makeFakeSession("sess-123");
    sessionMocks.getSession.mockReturnValueOnce(session);

    const handlers = registerHandlers();
    const handler = getRequiredHandler(handlers, "subagent_spawned");
    handler(createSpawnedEvent({ label: undefined }), {});

    expect(sessionMocks.wsSend).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ taskLabel: "background task" }),
    );
  });

  it("no-ops when channel is not desktop-robot", () => {
    const handlers = registerHandlers();
    const handler = getRequiredHandler(handlers, "subagent_spawned");
    handler(createSpawnedEvent({ requester: { channel: "telegram" } }), {});

    expect(sessionMocks.getSession).not.toHaveBeenCalled();
    expect(sessionMocks.wsSend).not.toHaveBeenCalled();
  });

  it("no-ops when to field does not start with ws:", () => {
    const handlers = registerHandlers();
    const handler = getRequiredHandler(handlers, "subagent_spawned");
    handler(createSpawnedEvent({ requester: { to: "channel:123" } }), {});

    expect(sessionMocks.getSession).not.toHaveBeenCalled();
    expect(sessionMocks.wsSend).not.toHaveBeenCalled();
  });

  it("no-ops when session is not found", () => {
    sessionMocks.getSession.mockReturnValueOnce(undefined);

    const handlers = registerHandlers();
    const handler = getRequiredHandler(handlers, "subagent_spawned");
    handler(createSpawnedEvent(), {});

    expect(sessionMocks.getSession).toHaveBeenCalledWith("sess-123");
    expect(sessionMocks.wsSend).not.toHaveBeenCalled();
  });

  // ── subagent_ended ───────────────────────────────────────────────

  it("sends task_completed to the WS session on subagent_ended", () => {
    const session = makeFakeSession("sess-123");
    // First: register the child→parent mapping via subagent_spawned
    sessionMocks.getSession.mockReturnValue(session);

    const handlers = registerHandlers();
    const spawnHandler = getRequiredHandler(handlers, "subagent_spawned");
    spawnHandler(createSpawnedEvent(), {});
    sessionMocks.wsSend.mockClear();

    // Then: fire subagent_ended
    const endHandler = getRequiredHandler(handlers, "subagent_ended");
    endHandler(createEndedEvent(), {});

    expect(sessionMocks.wsSend).toHaveBeenCalledTimes(1);
    expect(sessionMocks.wsSend).toHaveBeenCalledWith(session, {
      type: "task_completed",
      taskRunId: "run-abc",
      summary: "Task completed",
    });
  });

  it("includes outcome in summary when not ok", () => {
    const session = makeFakeSession("sess-123");
    sessionMocks.getSession.mockReturnValue(session);

    const handlers = registerHandlers();
    const spawnHandler = getRequiredHandler(handlers, "subagent_spawned");
    spawnHandler(createSpawnedEvent(), {});
    sessionMocks.wsSend.mockClear();

    const endHandler = getRequiredHandler(handlers, "subagent_ended");
    endHandler(createEndedEvent({ outcome: "timeout" }), {});

    expect(sessionMocks.wsSend).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ summary: "Task ended: timeout" }),
    );
  });

  it("no-ops on subagent_ended when no prior spawn was tracked", () => {
    const handlers = registerHandlers();
    const handler = getRequiredHandler(handlers, "subagent_ended");
    handler(createEndedEvent({ targetSessionKey: "unknown:child" }), {});

    expect(sessionMocks.getSession).not.toHaveBeenCalled();
    expect(sessionMocks.wsSend).not.toHaveBeenCalled();
  });

  it("cleans up mapping after subagent_ended fires", () => {
    const session = makeFakeSession("sess-123");
    sessionMocks.getSession.mockReturnValue(session);

    const handlers = registerHandlers();
    const spawnHandler = getRequiredHandler(handlers, "subagent_spawned");
    spawnHandler(createSpawnedEvent(), {});

    const endHandler = getRequiredHandler(handlers, "subagent_ended");
    endHandler(createEndedEvent(), {});
    sessionMocks.wsSend.mockClear();
    sessionMocks.getSession.mockClear();

    // Second ended call should no-op (mapping already cleaned up)
    endHandler(createEndedEvent(), {});
    expect(sessionMocks.getSession).not.toHaveBeenCalled();
    expect(sessionMocks.wsSend).not.toHaveBeenCalled();
  });

  it("no-ops on subagent_ended when parent session is gone", () => {
    const session = makeFakeSession("sess-123");
    sessionMocks.getSession.mockReturnValueOnce(session); // for spawn
    const handlers = registerHandlers();
    const spawnHandler = getRequiredHandler(handlers, "subagent_spawned");
    spawnHandler(createSpawnedEvent(), {});
    sessionMocks.wsSend.mockClear();

    // Session disconnected before ended fires
    sessionMocks.getSession.mockReturnValueOnce(undefined);
    const endHandler = getRequiredHandler(handlers, "subagent_ended");
    endHandler(createEndedEvent(), {});

    expect(sessionMocks.wsSend).not.toHaveBeenCalled();
  });
});
