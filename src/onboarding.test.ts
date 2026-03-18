import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "./accounts.js";
import { desktopRobotOnboardingAdapter } from "./onboarding.js";

// ── helpers ──────────────────────────────────────────────────────────

function makePrompter(responses: Record<string, unknown>) {
  const queue = new Map<string, unknown[]>();
  for (const [key, value] of Object.entries(responses)) {
    queue.set(key, Array.isArray(value) ? [...value] : [value]);
  }

  function dequeue(method: string, opts: { message?: string } = {}): unknown {
    // Try matching by message substring first, then by method name.
    for (const [key, values] of queue) {
      if (opts.message && opts.message.toLowerCase().includes(key.toLowerCase()) && values.length) {
        return values.shift();
      }
    }
    const byMethod = queue.get(method);
    if (byMethod?.length) return byMethod.shift();
    // Sensible defaults.
    if (method === "confirm") return false;
    return "";
  }

  return {
    text: vi.fn((opts: { message?: string }) => Promise.resolve(dequeue("text", opts))),
    select: vi.fn((opts: { message?: string }) => Promise.resolve(dequeue("select", opts))),
    confirm: vi.fn((opts: { message?: string }) => Promise.resolve(dequeue("confirm", opts))),
    note: vi.fn(() => Promise.resolve()),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function emptyCfg(): CoreConfig {
  return {};
}

function configuredCfg(): CoreConfig {
  return {
    channels: {
      "desktop-robot": {
        enabled: true,
        serve: { port: 18790, bind: "127.0.0.1" },
      },
    },
  };
}

// ── getStatus ────────────────────────────────────────────────────────

describe("desktopRobotOnboardingAdapter.getStatus", () => {
  it("returns configured=true even with empty config (no credentials needed)", async () => {
    // Reachy is "configured" by default — it only needs enabled !== false.
    const result = await desktopRobotOnboardingAdapter.getStatus({
      cfg: emptyCfg(),
    } as never);
    expect(result.configured).toBe(true);
    expect(result.statusLines[0]).toContain("configured");
  });

  it("returns configured=false when explicitly disabled", async () => {
    const cfg: CoreConfig = {
      channels: { "desktop-robot": { enabled: false } },
    };
    const result = await desktopRobotOnboardingAdapter.getStatus({
      cfg,
    } as never);
    expect(result.configured).toBe(false);
    expect(result.statusLines[0]).toContain("not configured");
  });

  it("returns configured=true when enabled", async () => {
    const result = await desktopRobotOnboardingAdapter.getStatus({
      cfg: configuredCfg(),
    } as never);
    expect(result.configured).toBe(true);
    expect(result.statusLines[0]).toContain("configured");
    expect(result.statusLines[0]).toContain("18790");
  });

  it("includes ws URL in status line", async () => {
    const cfg: CoreConfig = {
      channels: {
        "desktop-robot": {
          enabled: true,
          serve: { port: 9999, bind: "0.0.0.0", path: "/bot" },
        },
      },
    };
    const result = await desktopRobotOnboardingAdapter.getStatus({
      cfg,
    } as never);
    expect(result.statusLines[0]).toContain("ws://0.0.0.0:9999/bot");
  });
});

// ── configure ────────────────────────────────────────────────────────

describe("desktopRobotOnboardingAdapter.configure", () => {
  it("applies basic config from wizard prompts", async () => {
    const prompter = makePrompter({
      "Agent ID": "my-agent",
      "Response model": "dashscope/kimi-k2.5",
      "WebSocket port": "19000",
      "Bind address": "0.0.0.0",
      "Auth token": "secret123",
      "Allow anonymous": true,
      "Allowed tools": "sessions_spawn, cron",
    });

    const result = await desktopRobotOnboardingAdapter.configure({
      cfg: emptyCfg(),
      prompter: prompter as never,
      accountOverrides: {},
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
      options: {},
    } as never);

    const dr = (result.cfg as CoreConfig).channels?.["desktop-robot"];
    expect(dr).toBeDefined();
    expect(dr?.enabled).toBe(true);
    expect(dr?.agentId).toBe("my-agent");
    expect(dr?.responseModel).toBe("dashscope/kimi-k2.5");
    expect(dr?.serve?.port).toBe(19000);
    expect(dr?.serve?.bind).toBe("0.0.0.0");
    expect(dr?.auth?.token).toBe("secret123");
    expect(dr?.auth?.allowAnonymous).toBe(true);
    expect(dr?.tools).toEqual(["sessions_spawn", "cron"]);
    expect(result.accountId).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("writes to accounts.<id> for named accounts", async () => {
    const prompter = makePrompter({
      "Agent ID": "desktop-robot",
      "Response model": "",
      "WebSocket port": "18790",
      "Bind address": "127.0.0.1",
      "Auth token": "",
      "Allowed tools": "",
    });

    const result = await desktopRobotOnboardingAdapter.configure({
      cfg: emptyCfg(),
      prompter: prompter as never,
      accountOverrides: { "desktop-robot": "office" },
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
      options: {},
    } as never);

    const dr = (result.cfg as CoreConfig).channels?.["desktop-robot"];
    expect(dr?.accounts?.office).toBeDefined();
    expect(dr?.accounts?.office?.enabled).toBe(true);
    expect(dr?.accounts?.office?.agentId).toBe("desktop-robot");
    expect(result.accountId).toBe("office");
  });

  it("offers agent select when agents exist in config", async () => {
    const cfg = {
      ...emptyCfg(),
      agents: { list: [{ id: "home-bot", name: "Home Bot" }, { id: "work-bot" }] },
    };

    const prompter = makePrompter({
      select: "home-bot",
      "Response model": "",
      "WebSocket port": "18790",
      "Bind address": "127.0.0.1",
      "Auth token": "",
      "Allowed tools": "",
    });

    const result = await desktopRobotOnboardingAdapter.configure({
      cfg,
      prompter: prompter as never,
      accountOverrides: {},
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
      options: {},
    } as never);

    expect(prompter.select).toHaveBeenCalled();
    const dr = (result.cfg as CoreConfig).channels?.["desktop-robot"];
    expect(dr?.agentId).toBe("home-bot");
  });
});

// ── disable ──────────────────────────────────────────────────────────

describe("desktopRobotOnboardingAdapter.disable", () => {
  it("sets enabled=false", () => {
    const result = desktopRobotOnboardingAdapter.disable!(configuredCfg());
    const dr = (result as CoreConfig).channels?.["desktop-robot"];
    expect(dr?.enabled).toBe(false);
  });
});
