import crypto from "node:crypto";
import type { SessionEntry } from "./session.js";
import { wsSend } from "./session.js";

export type StreamRelayCallbacks = {
  onAssistantMessageStart: () => void;
  onPartialReply: (payload: { text?: string; mediaUrls?: string[] }) => void;
  onBlockReply: (payload: { text?: string; mediaUrls?: string[] }) => void;
  onAgentEvent: (evt: { stream: string; data: Record<string, unknown> }) => void;
};

// Matches [emotion:happy] or [emotion:thinking] etc. in LLM output
const EMOTION_TAG_RE = /\[emotion:(\w+)\]/g;

/**
 * Build the streaming callbacks that bridge `runEmbeddedPiAgent` output
 * into WebSocket messages for the desktop client.
 */
export function buildStreamCallbacks(
  session: SessionEntry,
  runId: string,
  opts?: { minChunkChars?: number },
): StreamRelayCallbacks {
  const minChunk = opts?.minChunkChars ?? 1;
  let pendingText = "";

  const flush = () => {
    if (pendingText.length >= minChunk) {
      wsSend(session, { type: "stream_delta", text: pendingText, runId });
      session.textBuffer += pendingText;
      pendingText = "";
    }
  };

  const appendText = (text?: string) => {
    if (!text) return;

    // Extract and send emotion tags before appending to text stream
    const cleaned = text.replace(EMOTION_TAG_RE, (_match, emotion: string) => {
      wsSend(session, { type: "emotion", emotion });
      return ""; // strip from text sent to TTS
    });

    if (cleaned) {
      pendingText += cleaned;
      flush();
    }
  };

  /** Force-flush any remaining text (call at stream end). */
  const flushRemaining = () => {
    if (pendingText) {
      wsSend(session, { type: "stream_delta", text: pendingText, runId });
      session.textBuffer += pendingText;
      pendingText = "";
    }
  };

  return {
    onAssistantMessageStart: () => {
      wsSend(session, { type: "stream_start", runId });
    },
    // onPartialReply receives CUMULATIVE text, not deltas — skip it.
    // We extract actual deltas from onAgentEvent (stream=assistant, data.delta).
    onPartialReply: () => {},
    onBlockReply: () => {},
    onAgentEvent: (evt) => {
      if (evt.stream === "assistant" && evt.data) {
        const delta = evt.data.delta as string | undefined;
        appendText(delta);
      } else if (evt.stream === "tool" && evt.data) {
        const phase = evt.data.phase as string | undefined;
        const toolName = (evt.data.name ?? evt.data.tool ?? "unknown") as string;
        if (phase === "start") {
          // Flush text before tool indicator
          flushRemaining();
          wsSend(session, { type: "tool_start", toolName, runId });

          // Forward reachy_* tool calls as robot_command for client-side execution
          if (toolName.startsWith("reachy_")) {
            const action = toolName.replace(/^reachy_/, "");
            const params = (evt.data.input ?? evt.data.args ?? {}) as Record<string, unknown>;
            const commandId = crypto.randomUUID();
            wsSend(session, { type: "robot_command", action, params, commandId });
          }
        } else if (phase === "end") {
          wsSend(session, { type: "tool_end", toolName, runId });
        }
      }
    },
    // Expose flush for callers to drain at end
    ...({ _flushRemaining: flushRemaining } as Record<string, unknown>),
  } as StreamRelayCallbacks;
}

/** Drain any buffered text. Call after the agent run completes. */
export function flushStreamRelay(callbacks: StreamRelayCallbacks): void {
  const extra = callbacks as unknown as { _flushRemaining?: () => void };
  extra._flushRemaining?.();
}
