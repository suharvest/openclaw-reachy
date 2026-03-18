// ── Inbound (Desktop → OpenClaw) ──────────────────────────────────────

export type HelloMessage = {
  type: "hello";
  sessionId?: string;
  authToken?: string;
};

export type UserMessage = {
  type: "message";
  text: string;
};

export type InterruptMessage = {
  type: "interrupt";
};

export type StateChangeMessage = {
  type: "state_change";
  state: "listening" | "idle" | "speaking_done";
};

export type PingMessage = {
  type: "ping";
  ts?: number;
};

export type RobotResultMessage = {
  type: "robot_result";
  commandId: string;
  result: Record<string, unknown>;
};

export type InboundMessage =
  | HelloMessage
  | UserMessage
  | InterruptMessage
  | StateChangeMessage
  | PingMessage
  | RobotResultMessage;

// ── Outbound (OpenClaw → Desktop) ────────────────────────────────────

export type WelcomeMessage = {
  type: "welcome";
  sessionId: string;
};

export type StreamStartMessage = {
  type: "stream_start";
  runId: string;
};

export type StreamDeltaMessage = {
  type: "stream_delta";
  text: string;
  runId: string;
};

export type StreamEndMessage = {
  type: "stream_end";
  runId: string;
  fullText: string;
};

export type StreamAbortMessage = {
  type: "stream_abort";
  runId: string;
  reason: string;
};

export type ServerStateMessage = {
  type: "state";
  state: "idle" | "processing";
};

export type ToolStartMessage = {
  type: "tool_start";
  toolName: string;
  runId: string;
};

export type ToolEndMessage = {
  type: "tool_end";
  toolName: string;
  runId: string;
};

export type TaskSpawnedMessage = {
  type: "task_spawned";
  taskLabel: string;
  taskRunId: string;
};

export type TaskCompletedMessage = {
  type: "task_completed";
  taskRunId: string;
  summary: string;
  /** First ~200 chars of the sub-agent result, suitable for a TTS briefing. */
  resultPreview?: string;
};

export type ErrorMessage = {
  type: "error";
  message: string;
  code?: string;
};

export type PongMessage = {
  type: "pong";
  ts?: number;
};

/** Passive emotion channel — tells the client to express an emotion immediately. */
export type EmotionMessage = {
  type: "emotion";
  emotion: string;
};

/** Active robot command — forwards a tool call for client-side execution. */
export type RobotCommandMessage = {
  type: "robot_command";
  action: string;
  params: Record<string, unknown>;
  commandId: string;
};

export type OutboundMessage =
  | WelcomeMessage
  | StreamStartMessage
  | StreamDeltaMessage
  | StreamEndMessage
  | StreamAbortMessage
  | ServerStateMessage
  | ToolStartMessage
  | ToolEndMessage
  | TaskSpawnedMessage
  | TaskCompletedMessage
  | ErrorMessage
  | PongMessage
  | EmotionMessage
  | RobotCommandMessage;
