# openclaw-reachy

OpenClaw channel plugin for Reachy robots — WebSocket bridge with emotion, voice, and hardware control.

STT (speech-to-text) and TTS (text-to-speech) are handled client-side. This plugin provides:

- A WebSocket server that accepts connections from Reachy robot clients
- Streaming text responses with chunked delivery (TTS-friendly)
- Emotion channel — the AI expresses emotions (happy, thinking, etc.) alongside text
- Robot command forwarding — tool calls are forwarded to the client for SDK-level hardware execution
- Background task delegation via `sessions_spawn` for non-trivial work
- Task completion notifications with result preview for voice briefings
- Session state machine (idle → listening → processing → speaking)
- Idle timeout sweep (configurable, default 30 min)
- Token-based auth (timing-safe comparison) or anonymous access

## Install

From npm:

```bash
openclaw plugins install @seeed-studio/openclaw-reachy
```

Then use the onboarding wizard:

```bash
openclaw setup
# select Reachy and follow the prompts
```

Start the gateway, then connect via WebSocket:

```
ws://127.0.0.1:18790/desktop-robot
```

## Configuration

All fields are optional. Shown with defaults:

```jsonc
{
  "channels": {
    "desktop-robot": {
      "enabled": true,
      "serve": {
        "port": 18790,
        "bind": "127.0.0.1",
        "path": "/desktop-robot",
      },
      "auth": {
        "token": "", // if set, clients must provide this token
        "allowAnonymous": false,
      },
      "session": {
        "idleTimeoutMs": 1800000, // 30 min — sessions exceeding this are closed
        "maxSessions": 5,
      },
      "streaming": {
        "minChunkChars": 10, // min chars per stream_delta
        "flushIntervalMs": 100,
      },
      "responseModel": "", // e.g. "dashscope/kimi-k2.5"
      "responseSystemPrompt": "", // override default voice prompt
      "agentId": "desktop-robot",
      "tools": [], // allowed tools, e.g. ["sessions_spawn", "cron"]
      // empty = use core defaults
      "dmPolicy": "open",
      "allowFrom": [],
    },
  },
}
```

## WebSocket protocol

All messages are JSON. Each has a `type` field.

### Inbound (Client → Server)

| Type           | Fields                     | Description                                                       |
| -------------- | -------------------------- | ----------------------------------------------------------------- |
| `hello`        | `sessionId?`, `authToken?` | Start session. Optional `sessionId` to resume.                    |
| `message`      | `text`                     | Send user message (from STT).                                     |
| `interrupt`    | —                          | Barge-in: abort current response.                                 |
| `state_change` | `state`                    | Client reports state: `"listening"`, `"idle"`, `"speaking_done"`. |
| `ping`         | `ts?`                      | Keepalive. Server replies with `pong`.                            |
| `robot_result` | `commandId`, `result`      | Client reports result of a robot command execution.               |

### Outbound (Server → Client)

| Type             | Fields                                   | Description                                                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `welcome`        | `sessionId`                              | Session established.                                                            |
| `state`          | `state`                                  | Server state: `"idle"` or `"processing"`.                                       |
| `stream_start`   | `runId`                                  | Response stream begins.                                                         |
| `stream_delta`   | `text`, `runId`                          | Incremental text chunk (feed to TTS).                                           |
| `stream_end`     | `runId`, `fullText`                      | Response complete.                                                              |
| `stream_abort`   | `runId`, `reason`                        | Response aborted (interrupt or error).                                          |
| `tool_start`     | `toolName`, `runId`                      | Agent started a tool call.                                                      |
| `tool_end`       | `toolName`, `runId`                      | Agent finished a tool call.                                                     |
| `emotion`        | `emotion`                                | AI emotion to display (e.g. `"happy"`, `"thinking"`).                           |
| `robot_command`  | `action`, `params`, `commandId`          | Hardware command for client-side SDK execution.                                 |
| `task_spawned`   | `taskLabel`, `taskRunId`                 | Background task started via `sessions_spawn`.                                   |
| `task_completed` | `taskRunId`, `summary`, `resultPreview?` | Background task finished. `resultPreview` is first ~200 chars for TTS briefing. |
| `error`          | `message`, `code?`                       | Error.                                                                          |
| `pong`           | `ts?`                                    | Reply to `ping`.                                                                |

## Emotion channel

The AI includes an emotion tag at the start of each reply (e.g. `[emotion:happy]`). The plugin strips the tag from the text stream and sends a separate `emotion` message so the client can update the robot's facial expression independently from TTS.

Available emotions: `happy`, `sad`, `angry`, `surprised`, `thinking`, `confused`, `curious`, `excited`, `laugh`, `fear`, `neutral`, `listening`, `agreeing`, `disagreeing`.

```
Client                          Server
  │                               │
  │──── message {text} ─────────▶│
  │◀─── emotion {happy} ─────────│  ← update face immediately
  │◀─── stream_delta (×N) ──────│  ← TTS text (emotion tag stripped)
  │◀─── stream_end ─────────────│
```

## Robot commands

When the AI invokes a tool prefixed with `reachy_` (e.g. `reachy_move_head`, `reachy_dance`), the plugin forwards it as a `robot_command` message for client-side SDK execution. The client executes the command via its local robot SDK and optionally reports the result via `robot_result`.

Tool schemas are auto-registered from `SKILL.md` at startup — see [Auto-loading tools from SKILL.md](#auto-loading-tools-from-skillmd).

```
Client                          Server
  │                               │
  │◀─── robot_command ───────────│  action="move_head", params={yaw:20}, commandId="abc"
  │  (execute via robot SDK)      │
  │──── robot_result ────────────▶│  commandId="abc", result={ok: true}
```

To enable robot tools, add the tool names to the `tools` allowlist:

```jsonc
{
  "channels": {
    "desktop-robot": {
      "tools": ["sessions_spawn", "reachy_move_head", "reachy_dance", "reachy_capture_image"],
    },
  },
}
```

## Typical flow

```
Client                          Server
  │                               │
  │──── hello ──────────────────▶│
  │◀─── welcome {sessionId} ────│
  │                               │
  │──── message {text} ─────────▶│
  │◀─── state {processing} ─────│
  │◀─── emotion {thinking} ─────│  ← robot shows thinking face
  │◀─── stream_start ───────────│
  │◀─── stream_delta (×N) ──────│  ← feed chunks to TTS
  │◀─── stream_end {fullText} ──│
  │                               │
  │──── state_change             │
  │     {speaking_done} ────────▶│
  │◀─── state {idle} ───────────│
```

### Background task flow

For complex tasks (search, code generation, analysis), the AI delegates to a background sub-agent:

```
Client                          Server
  │                               │
  │──── message {complex task} ─▶│
  │◀─── state {processing} ─────│
  │◀─── task_spawned ───────────│  ← task started in background
  │◀─── stream_end {ack} ───────│  ← short acknowledgement for TTS
  │                               │
  │  (client is free to send      │  ← sub-agent works in background
  │   new messages meanwhile)     │
  │                               │
  │◀─── stream_end {result} ────│  ← full result delivered (runId: "send-...")
  │◀─── task_completed ─────────│  ← includes resultPreview for TTS briefing
```

## Authentication

If `auth.token` is set and `auth.allowAnonymous` is false, clients must authenticate via:

- Query parameter: `ws://host:port/desktop-robot?token=SECRET`
- Header: `Authorization: Bearer SECRET`

Token comparison uses `crypto.timingSafeEqual` to prevent timing attacks.

## State machine

```
idle ──▶ listening ──▶ processing ──▶ speaking
  ▲                                      │
  └──────────────────────────────────────┘
                speaking_done

  speaking ──▶ listening    (barge-in / interrupt)
  any ──────▶ idle          (recovery path)
```

## Auto-loading tools from SKILL.md

Place a `SKILL.md` file in the extension root (`extensions/desktop-robot/SKILL.md`) and the plugin will automatically parse it and register tools with proper JSON schemas at startup. This means you maintain a single file — the LLM gets real function-call schemas, and the robot client receives `robot_command` messages.

Expected format:

```markdown
### `reachy_move_head`

Move head to target position.

- `yaw` (float): Left/right degrees, ±45 max
- `pitch` (float): Up/down degrees, ±30 max

### `reachy_capture_image`

Capture camera image. Returns filepath.
```

Supported parameter types: `float`/`number`, `int`/`integer`, `bool`/`boolean`, `string`.

Tools without parameters are also supported (e.g. `reachy_status`).

## Source structure

```
├── index.ts              # Plugin entry: registers channel + subagent hooks + tools
├── SKILL.md              # Robot tool definitions (auto-parsed at startup)
├── package.json
├── openclaw.plugin.json  # Plugin configuration and schema
├── LICENSE
├── CHANGELOG.md
└── src/
    ├── accounts.ts       # Account resolution from config
    ├── channel.ts        # ChannelPlugin definition (outbound sendText, onboarding)
    ├── config-schema.ts  # Zod schemas for config validation
    ├── core-bridge.ts    # Dynamic import bridge to core agent runner
    ├── onboarding.ts     # Interactive setup wizard (openclaw setup)
    ├── protocol.ts       # TypeScript types for all WS messages
    ├── reachy-tools.ts   # Registers SKILL.md tools via plugin API
    ├── runtime.ts        # Server runtime state per account
    ├── send.ts           # Outbound message delivery (announce → WS)
    ├── server.ts         # WebSocket server + message handlers
    ├── session.ts        # Session management (create/remove/list, idle sweep)
    ├── skill-parser.ts   # SKILL.md → tool schema parser
    ├── state.ts          # Conversation state machine
    ├── stream-relay.ts   # Chunked streaming relay + emotion extraction
    └── subagent-hooks.ts # task_spawned / task_completed WS events
```
