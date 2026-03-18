export type ConversationState = "idle" | "listening" | "processing" | "speaking";

const TERMINAL_STATES = new Set<ConversationState>();

// Valid forward transitions (non-terminal).
// Speaking ↔ listening is bidirectional (barge-in / resume).
const VALID_TRANSITIONS: Record<ConversationState, Set<ConversationState>> = {
  idle: new Set(["listening", "processing"]),
  listening: new Set(["processing", "idle"]),
  processing: new Set(["speaking", "idle"]),
  speaking: new Set(["idle", "listening"]),
};

export function transitionState(
  current: ConversationState,
  next: ConversationState,
): { ok: boolean; state: ConversationState } {
  if (current === next) {
    return { ok: true, state: current };
  }
  if (TERMINAL_STATES.has(current)) {
    return { ok: false, state: current };
  }
  if (VALID_TRANSITIONS[current]?.has(next)) {
    return { ok: true, state: next };
  }
  // Allow any → idle as a recovery path
  if (next === "idle") {
    return { ok: true, state: next };
  }
  return { ok: false, state: current };
}
