import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  promptAccountId,
  type ChannelOnboardingAdapter,
  type ChannelOnboardingDmPolicy,
  type DmPolicy,
  type WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  listDesktopRobotAccountIds,
  resolveDefaultDesktopRobotAccountId,
  resolveDesktopRobotAccount,
  type CoreConfig,
} from "./accounts.js";
import type { DesktopRobotAccountConfig } from "./config-schema.js";

const channel = "desktop-robot" as const;

type CfgWithAgents = CoreConfig & {
  agents?: { list?: Array<{ id: string; name?: string }> };
};

function parseListInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function updateDesktopRobotAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: Partial<DesktopRobotAccountConfig>,
): CoreConfig {
  const current = cfg.channels?.["desktop-robot"] ?? {};
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        "desktop-robot": {
          ...current,
          ...patch,
        },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "desktop-robot": {
        ...current,
        accounts: {
          ...current.accounts,
          [accountId]: {
            ...current.accounts?.[accountId],
            ...patch,
          },
        },
      },
    },
  };
}

function setDesktopRobotDmPolicy(cfg: CoreConfig, dmPolicy: DmPolicy): CoreConfig {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.["desktop-robot"]?.allowFrom)
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "desktop-robot": {
        ...cfg.channels?.["desktop-robot"],
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setDesktopRobotAllowFrom(cfg: CoreConfig, allowFrom: string[]): CoreConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "desktop-robot": {
        ...cfg.channels?.["desktop-robot"],
        allowFrom,
      },
    },
  };
}

async function promptDesktopRobotAllowFrom(params: {
  cfg: CoreConfig;
  prompter: WizardPrompter;
}): Promise<CoreConfig> {
  const existing = params.cfg.channels?.["desktop-robot"]?.allowFrom ?? [];

  await params.prompter.note(
    ["Allowlist Reachy DMs by sender ID.", "Multiple entries: comma-separated."].join("\n"),
    "Reachy allowlist",
  );

  const raw = await params.prompter.text({
    message: "Reachy allowFrom",
    placeholder: "sender-id-1, sender-id-2",
    initialValue: existing[0] ? String(existing[0]) : undefined,
    validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
  });

  const parsed = parseListInput(String(raw));
  return setDesktopRobotAllowFrom(params.cfg, parsed);
}

async function promptAgentId(params: {
  cfg: CfgWithAgents;
  prompter: WizardPrompter;
  currentAgentId?: string;
}): Promise<string> {
  const agents = params.cfg.agents?.list ?? [];

  if (agents.length > 0) {
    const options = [
      ...agents.map((a) => ({
        value: a.id,
        label: a.name ? `${a.id} (${a.name})` : a.id,
      })),
      { value: "__custom__", label: "Custom (enter manually)" },
    ];

    const choice = await params.prompter.select({
      message: "Agent ID for Reachy",
      options,
      initialValue: params.currentAgentId ?? "desktop-robot",
    });

    if (String(choice) !== "__custom__") {
      return String(choice);
    }
  }

  const input = await params.prompter.text({
    message: "Agent ID",
    placeholder: "desktop-robot",
    initialValue: params.currentAgentId ?? "desktop-robot",
  });
  return String(input).trim() || "desktop-robot";
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Reachy",
  channel,
  policyKey: "channels.desktop-robot.dmPolicy",
  allowFromKey: "channels.desktop-robot.allowFrom",
  getCurrent: (cfg) => (cfg as CoreConfig).channels?.["desktop-robot"]?.dmPolicy ?? "open",
  setPolicy: (cfg, policy) => setDesktopRobotDmPolicy(cfg as CoreConfig, policy),
  promptAllowFrom: (params) =>
    promptDesktopRobotAllowFrom({ cfg: params.cfg as CoreConfig, prompter: params.prompter }),
};

export const desktopRobotOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const coreCfg = cfg as CoreConfig;
    const accounts = listDesktopRobotAccountIds(coreCfg);
    const configuredAccount = accounts.find(
      (accountId) => resolveDesktopRobotAccount({ cfg: coreCfg, accountId }).configured,
    );
    const configured = Boolean(configuredAccount);
    let statusLine = "Reachy: not configured";
    if (configured && configuredAccount) {
      const resolved = resolveDesktopRobotAccount({ cfg: coreCfg, accountId: configuredAccount });
      statusLine = `Reachy: configured (ws://${resolved.bind}:${resolved.port}${resolved.path})`;
    }
    return {
      channel,
      configured,
      statusLines: [statusLine],
      selectionHint: configured ? "configured" : "needs setup",
      quickstartScore: configured ? 1 : 0,
    };
  },
  configure: async ({
    cfg,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
    forceAllowFrom,
  }) => {
    let next = cfg as CoreConfig;
    const override = (accountOverrides as Record<string, string | undefined>)[
      "desktop-robot"
    ]?.trim();
    const defaultAccountId = resolveDefaultDesktopRobotAccountId(next);
    let accountId = override || defaultAccountId;

    if (shouldPromptAccountIds && !override) {
      accountId = await promptAccountId({
        cfg: next,
        prompter,
        label: "Reachy",
        currentId: accountId,
        listAccountIds: listDesktopRobotAccountIds,
        defaultAccountId,
      });
    }

    const resolved = resolveDesktopRobotAccount({ cfg: next, accountId });

    if (!resolved.configured) {
      await prompter.note(
        [
          "Reachy is a WebSocket bridge for Reachy robots.",
          "STT/TTS and hardware control are handled client-side.",
          "Clients connect via WebSocket to receive streamed responses with emotion tags.",
        ].join("\n"),
        "Reachy setup",
      );
    }

    // Agent ID selection.
    const agentId = await promptAgentId({
      cfg: next as CfgWithAgents,
      prompter,
      currentAgentId: resolved.config.agentId,
    });

    // Response model (optional).
    const modelInput = String(
      await prompter.text({
        message: "Response model (blank = gateway default)",
        placeholder: "provider/model (e.g. dashscope/kimi-k2.5)",
        initialValue: resolved.config.responseModel || undefined,
      }),
    ).trim();

    // WebSocket port.
    const portInput = String(
      await prompter.text({
        message: "WebSocket port (1-65535)",
        initialValue: String(resolved.port),
        validate: (value) => {
          const n = Number.parseInt(String(value), 10);
          if (!Number.isFinite(n) || n < 1 || n > 65535) return "Port must be 1-65535";
          return undefined;
        },
      }),
    ).trim();
    const port = Number.parseInt(portInput, 10);

    // Bind address.
    const bind = String(
      await prompter.text({
        message: "Bind address",
        initialValue: resolved.bind,
      }),
    ).trim();

    // Auth token (optional). Don't prefill existing token to avoid leaking secrets.
    const hasExistingToken = Boolean(resolved.config.auth?.token);
    const token = String(
      await prompter.text({
        message: hasExistingToken
          ? "Auth token (blank = remove, enter to keep current)"
          : "Auth token (blank = no auth)",
        placeholder: hasExistingToken ? "(current token hidden)" : "secret-token",
      }),
    ).trim();

    // Allow anonymous — only ask if token is set.
    let allowAnonymous = false;
    if (token) {
      allowAnonymous = await prompter.confirm({
        message: "Allow anonymous connections (no token)?",
        initialValue: resolved.config.auth?.allowAnonymous ?? false,
      });
    }

    // WebSocket path.
    const wsPath = String(
      await prompter.text({
        message: "WebSocket path",
        initialValue: resolved.path,
      }),
    ).trim();

    // Tools (optional, comma-separated).
    // Note: blank means "use core defaults" (not "no tools").
    const toolsInput = String(
      await prompter.text({
        message: "Allowed tools (comma-separated, blank = core defaults)",
        placeholder: "sessions_spawn, cron",
        initialValue: resolved.config.tools?.length ? resolved.config.tools.join(", ") : undefined,
      }),
    ).trim();
    const tools = parseListInput(toolsInput);

    // Build patch.
    const patch: Partial<DesktopRobotAccountConfig> = {
      enabled: true,
      agentId,
      serve: {
        port: Number.isFinite(port) ? port : resolved.port,
        bind: bind || "127.0.0.1",
        path: wsPath || resolved.path,
      },
      tools,
      // Explicitly clear responseModel when blank so old value is removed.
      responseModel: modelInput || undefined,
    };
    if (token) {
      patch.auth = { token, allowAnonymous };
    } else if (hasExistingToken) {
      // Blank input with existing token: explicitly clear auth.
      patch.auth = { token: undefined, allowAnonymous: false };
    }

    next = updateDesktopRobotAccountConfig(next, accountId, patch);

    if (forceAllowFrom) {
      next = await promptDesktopRobotAllowFrom({ cfg: next, prompter });
    }

    await prompter.note(
      [
        "Next: restart gateway and verify status.",
        "Command: openclaw channels status --probe",
      ].join("\n"),
      "Reachy next steps",
    );

    return { cfg: next, accountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...(cfg as CoreConfig),
    channels: {
      ...(cfg as CoreConfig).channels,
      "desktop-robot": {
        ...(cfg as CoreConfig).channels?.["desktop-robot"],
        enabled: false,
      },
    },
  }),
};
