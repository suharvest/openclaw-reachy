# Changelog

## 0.3.0

### Changes

- Auto-register robot tools from `SKILL.md` at startup — no manual tool definition needed
- Rebrand display labels from Desktop Robot to Reachy

## 0.2.0

### Changes

- Add emotion channel — AI expresses emotions via `[emotion:tag]` in responses, stripped from text and sent as separate WS messages
- Add robot command forwarding — `reachy_*` tool calls sent as `robot_command` messages for client-side SDK execution
- Add background task delegation via `sessions_spawn` with `task_spawned` / `task_completed` WS events
- Add task completion result preview for TTS briefing

## 0.1.0

### Changes

- Initial release
- WebSocket server with session management and idle timeout sweep
- Streaming text responses with chunked delivery for TTS
- Token-based auth with timing-safe comparison
- Session state machine (idle → listening → processing → speaking)
- Barge-in / interrupt support
