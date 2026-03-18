/**
 * Manual E2E test for the desktop-robot WebSocket server.
 *
 * Prerequisites:
 *   - Gateway running with Node 22+ on ws://127.0.0.1:18790/desktop-robot
 *   - desktop-robot plugin enabled in openclaw.json
 *
 * Run:
 *   bun extensions/desktop-robot/src/e2e.test.manual.ts [test-name]
 *
 * Available tests:
 *   hello        - Basic connection + greeting (simple task, direct reply)
 *   routing      - Complex task routes to sessions_spawn (no inline tools)
 *   roundtrip    - Full round-trip: spawn → sub-agent completes → result + task_completed
 *   concurrent   - Send a follow-up message while background task runs
 *   all          - Run all tests sequentially (default)
 */

const WS_URL = "ws://127.0.0.1:18790/desktop-robot";

// ── Helpers ──────────────────────────────────────────────────────────

type Msg = Record<string, unknown>;

function createClient(timeoutMs = 60_000): {
  ws: WebSocket;
  events: Msg[];
  waitFor: (predicate: (msg: Msg) => boolean, label?: string) => Promise<Msg>;
  send: (msg: Record<string, unknown>) => void;
  close: () => void;
} {
  const ws = new WebSocket(WS_URL);
  const events: Msg[] = [];
  const listeners: Array<{ predicate: (m: Msg) => boolean; resolve: (m: Msg) => void }> = [];

  const timer = setTimeout(() => {
    console.error("TIMEOUT");
    process.exit(1);
  }, timeoutMs);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as Msg;
    events.push(msg);
    for (let i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i].predicate(msg)) {
        listeners[i].resolve(msg);
        listeners.splice(i, 1);
      }
    }
  };

  ws.onerror = (err) => {
    console.error("WS error:", err);
    process.exit(1);
  };

  return {
    ws,
    events,
    waitFor: (predicate, label) =>
      new Promise<Msg>((resolve) => {
        // Check already received
        const existing = events.find(predicate);
        if (existing) {
          resolve(existing);
          return;
        }
        listeners.push({ predicate, resolve });
      }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => {
      clearTimeout(timer);
      ws.close();
    },
  };
}

function hasType(msg: Msg, type: string): boolean {
  return msg.type === type;
}

function printResult(name: string, passed: boolean, detail?: string) {
  const icon = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${icon}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── Tests ────────────────────────────────────────────────────────────

async function testHello() {
  console.log("\n--- test: hello (simple task, direct reply) ---");
  const c = createClient(30_000);
  await new Promise<void>((r) => (c.ws.onopen = () => r()));

  c.send({ type: "hello" });
  const welcome = await c.waitFor((m) => hasType(m, "welcome"));
  printResult("welcome received", !!welcome.sessionId);

  c.send({ type: "message", text: "你好" });
  const end = await c.waitFor((m) => hasType(m, "stream_end"));
  const text = end.fullText as string;
  const noToolCalls = !c.events.some((m) => hasType(m, "tool_start"));
  printResult("direct reply (no tools)", noToolCalls, `"${text.slice(0, 60)}"`);

  c.close();
}

async function testRouting() {
  console.log("\n--- test: routing (complex task → sessions_spawn) ---");
  const c = createClient(30_000);
  await new Promise<void>((r) => (c.ws.onopen = () => r()));

  c.send({ type: "hello" });
  await c.waitFor((m) => hasType(m, "welcome"));

  c.send({
    type: "message",
    text: "帮我搜索一下2026年最新的 Rust web 框架对比",
  });
  const end = await c.waitFor((m) => hasType(m, "stream_end"));

  const hasSpawn = c.events.some((m) => hasType(m, "task_spawned"));
  printResult("task_spawned received", hasSpawn);

  const text = end.fullText as string;
  const isShort = text.length < 200;
  printResult("short acknowledgement", isShort, `${text.length} chars`);

  // No inline web_search/browser after sessions_spawn
  const spawnIdx = c.events.findIndex((m) => hasType(m, "task_spawned"));
  const inlineTools = c.events
    .slice(spawnIdx + 1)
    .filter(
      (m) =>
        hasType(m, "tool_start") &&
        ["web_search", "browser", "web_fetch"].includes(m.toolName as string),
    );
  printResult("no inline web tools after spawn", inlineTools.length === 0);

  c.close();
}

async function testRoundtrip() {
  console.log("\n--- test: roundtrip (spawn → result delivery → task_completed) ---");
  const c = createClient(180_000);
  await new Promise<void>((r) => (c.ws.onopen = () => r()));

  c.send({ type: "hello" });
  await c.waitFor((m) => hasType(m, "welcome"));

  c.send({
    type: "message",
    text: "搜索一下快速排序和归并排序的优缺点对比",
  });

  // Wait for task_completed (sub-agent must finish)
  const completed = await c.waitFor((m) => hasType(m, "task_completed"));
  printResult("task_completed received", true);

  const summary = completed.summary as string;
  printResult("summary present", !!summary, summary);

  const preview = completed.resultPreview as string | undefined;
  printResult("resultPreview present", !!preview, `${preview?.length ?? 0} chars`);

  // Result should also have been delivered via stream_end with "send-" runId
  const deliveryStream = c.events.find(
    (m) => hasType(m, "stream_end") && (m.runId as string).startsWith("send-"),
  );
  printResult("result delivered via send stream", !!deliveryStream);

  c.close();
}

async function testConcurrent() {
  console.log("\n--- test: concurrent (chat while background task runs) ---");
  const c = createClient(180_000);
  await new Promise<void>((r) => (c.ws.onopen = () => r()));

  c.send({ type: "hello" });
  await c.waitFor((m) => hasType(m, "welcome"));

  // Send complex task
  c.send({
    type: "message",
    text: "搜索一下堆排序的时间复杂度分析",
  });
  await c.waitFor((m) => hasType(m, "stream_end"));

  // Send simple follow-up while background task is running
  c.send({ type: "message", text: "1加1等于几" });
  const followUp = await c.waitFor(
    (m) =>
      hasType(m, "stream_end") &&
      !(m.runId as string).startsWith("send-") &&
      m !== c.events.find((e) => hasType(e, "stream_end")),
  );
  const text = followUp.fullText as string;
  printResult("follow-up answered while task runs", !!text, `"${text.slice(0, 60)}"`);

  c.close();
}

// ── Runner ───────────────────────────────────────────────────────────

const testMap: Record<string, () => Promise<void>> = {
  hello: testHello,
  routing: testRouting,
  roundtrip: testRoundtrip,
  concurrent: testConcurrent,
};

async function main() {
  const arg = process.argv[2] ?? "all";
  console.log(`desktop-robot E2E tests (${arg})\n`);

  if (arg === "all") {
    for (const [name, fn] of Object.entries(testMap)) {
      await fn();
    }
  } else if (testMap[arg]) {
    await testMap[arg]();
  } else {
    console.error(`Unknown test: ${arg}. Available: ${Object.keys(testMap).join(", ")}, all`);
    process.exit(1);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
