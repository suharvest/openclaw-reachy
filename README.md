<p align="center">
  <video src="https://github.com/suharvest/openclaw-reachy/releases/download/media-assets/demo.mp4" alt="openclaw-reachy demo" width="800" controls autoplay loop muted></video>
</p>

# openclaw-reachy

[![npm](https://img.shields.io/npm/v/@seeed-studio/openclaw-reachy)](https://www.npmjs.com/package/@seeed-studio/openclaw-reachy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-plugin-blue)](https://github.com/openclaw/openclaw)

OpenClaw plugin layer that connects OpenClaw to [Reachy Mini](https://www.pollen-robotics.com/reachy-mini/), turning AI responses, emotions, and tool calls into real-time robot behavior.

<!-- TODO: Add demo GIF here — 15s clip showing: user speaks → robot thinks (emotion) → robot replies + moves -->


## What is this?

openclaw-reachy is the plugin layer that connects [OpenClaw](https://github.com/openclaw/openclaw) to Reachy Mini, turning AI responses, emotions, and tool calls into real-time robot behavior.

It enables Reachy Mini to become a physical expression layer for OpenClaw — not just speaking AI output, but also showing emotion and executing robot actions in sync.

## Key Features

- **Real-time robot expression** — AI responses can be turned into speech, motion, and emotion in sync, making interaction feel more natural and alive.
- **Emotion channel** — emotional states are sent separately from speech, so Reachy Mini can react with facial expressions and behavior in real time.
- **Tool-driven robot actions** — OpenClaw tool calls can trigger physical actions such as head movement, gestures, or other robot behaviors.
- **Streaming voice interaction** — streaming text delivery helps reduce response delay and supports more fluid voice experiences.
- **Built for OpenClaw workflows** — this plugin helps bring OpenClaw out of the screen and into a physical robot experience.

## Table of Contents

- [Install](#install)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [WebSocket Protocol](#websocket-protocol)
- [Emotion Channel](#emotion-channel)
- [Robot Commands](#robot-commands)
- [Typical Flow](#typical-flow)
- [Authentication](#authentication)
- [State Machine](#state-machine)
- [Auto-loading Tools from SKILL.md](#auto-loading-tools-from-skillmd)
- [Source Structure](#source-structure)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Install

```bash
openclaw plugins install @seeed-studio/openclaw-reachy
```

Then use the onboarding wizard:

```bash
openclaw setup
# select Reachy and follow the prompts
```

## Quickstart

Start the OpenClaw gateway, then connect via WebSocket:

```javascript
// Node.js / browser WebSocket client example
const ws = new WebSocket("ws://127.0.0.1:18790/desktop-robot");

ws.onopen = () => {
  // 1. Start a session
  ws.send(JSON.stringify({ type: "hello" }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case "welcome":
      // 2. Session established — send a message
      ws.send(JSON.stringify({ type: "message", text: "Hello!" }));
      break;
    case "emotion":
      console.log("Robot emotion:", msg.emotion); // e.g. "happy"
      break;
    case "stream_delta":
      console.log("TTS chunk:", msg.text); // feed to TTS engine
      break;
    case "robot_command":
      console.log("Execute:", msg.action, msg.params); // e.g. "move_head" {yaw: 20}
      break;
  }
};
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

## WebSocket Protocol

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

## Emotion Channel

The AI includes an emotion tag at the start of each reply (e.g. `[emotion:happy]`). The plugin strips the tag from the text stream and sends a separate `emotion` message so the client can update the robot's facial expression independently from TTS.

Available emotions: `happy`, `sad`, `angry`, `surprised`, `thinking`, `confused`, `curious`, `excited`, `laugh`, `fear`, `neutral`, `listening`, `agreeing`, `disagreeing`.

```text
Client                          Server
  │                               │
  │──── message {text} ─────────▶│
  │◀─── emotion {happy} ─────────│  ← update face immediately
  │◀─── stream_delta (×N) ──────│  ← TTS text (emotion tag stripped)
  │◀─── stream_end ─────────────│
```

## Robot Commands

When the AI invokes a tool prefixed with `reachy_` (e.g. `reachy_move_head`, `reachy_dance`), the plugin forwards it as a `robot_command` message for client-side SDK execution. The client executes the command via its local robot SDK and optionally reports the result via `robot_result`.

Tool schemas are auto-registered from `SKILL.md` at startup — see [Auto-loading tools from SKILL.md](#auto-loading-tools-from-skillmd).

```text
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

## Typical Flow

```text
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

### Background Task Flow

For complex tasks (search, code generation, analysis), the AI delegates to a background sub-agent:

```text
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

## State Machine

```text
idle ──▶ listening ──▶ processing ──▶ speaking
  ▲                                      │
  └──────────────────────────────────────┘
                speaking_done

  speaking ──▶ listening    (barge-in / interrupt)
  any ──────▶ idle          (recovery path)
```

## Auto-loading Tools from SKILL.md

Place a `SKILL.md` file in the extension root and the plugin will automatically parse it and register tools with proper JSON schemas at startup. This means you maintain a single file — the LLM gets real function-call schemas, and the robot client receives `robot_command` messages.

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

## Source Structure

```text
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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an Issue.

## Acknowledgements

- [OpenClaw](https://github.com/openclaw/openclaw) — the AI gateway that powers the LLM backend
- [Reachy Mini](https://www.pollen-robotics.com/reachy-mini/) by [Pollen Robotics](https://www.pollen-robotics.com/) x [Hugging Face](https://huggingface.co/) — the robot hardware platform
- Built by [Seeed Studio](https://www.seeedstudio.com/)

## License

[MIT](LICENSE)
