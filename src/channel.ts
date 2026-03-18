import crypto from "node:crypto";
import {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import {
  listDesktopRobotAccountIds,
  resolveDefaultDesktopRobotAccountId,
  resolveDesktopRobotAccount,
  type CoreConfig,
  type ResolvedDesktopRobotAccount,
} from "./accounts.js";
import { DesktopRobotConfigSchema } from "./config-schema.js";
import { desktopRobotOnboardingAdapter } from "./onboarding.js";
import { getDesktopRobotRuntime } from "./runtime.js";
import { sendDesktopRobotMessage } from "./send.js";
import { createDesktopRobotServer, type DesktopRobotServer } from "./server.js";

type DesktopRobotProbe = { ok: boolean; error?: string; port?: number };

export const desktopRobotPlugin: ChannelPlugin<ResolvedDesktopRobotAccount, DesktopRobotProbe> = {
  id: "desktop-robot",
  meta: {
    id: "desktop-robot",
    label: "Reachy",
    selectionLabel: "Reachy (plugin)",
    docsPath: "/plugins/desktop-robot",
    docsLabel: "desktop-robot",
    blurb: "WebSocket bridge for Reachy robots with emotion, voice, and hardware control.",
    order: 90,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    blockStreaming: false,
  },
  onboarding: desktopRobotOnboardingAdapter,
  reload: { configPrefixes: ["channels.desktop-robot"] },
  configSchema: buildChannelConfigSchema(DesktopRobotConfigSchema),
  config: {
    listAccountIds: (cfg) => listDesktopRobotAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveDesktopRobotAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultDesktopRobotAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "desktop-robot",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "desktop-robot",
        accountId,
        clearBaseFields: [
          "name",
          "serve",
          "auth",
          "session",
          "streaming",
          "responseModel",
          "responseSystemPrompt",
          "agentId",
          "tools",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveDesktopRobotAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []
      ).map(String),
    resolveDefaultTo: () => undefined,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg as CoreConfig).channels?.["desktop-robot"]?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.desktop-robot.accounts.${resolvedAccountId}.`
        : "channels.desktop-robot.";
      return {
        policy: account.config.dmPolicy ?? "open",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: `${basePath}allowFrom`,
        approveHint: `openclaw config set ${basePath}dmPolicy open`,
      };
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text }) => {
      const result = await sendDesktopRobotMessage(to, text);
      return {
        channel: "desktop-robot",
        messageId: result.runId ?? crypto.randomUUID(),
        ...result,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ account, snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
      port: account.port,
      bind: account.bind,
      path: account.path,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => {
      if (!account.configured) {
        return { ok: false, error: "not configured" } as DesktopRobotProbe;
      }
      return { ok: true, port: account.port } as DesktopRobotProbe;
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      ...buildBaseAccountStatusSnapshot({ account, runtime, probe }),
      port: account.port,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(
          `Reachy is not configured for account "${account.accountId}". ` +
            `Enable it via channels.desktop-robot.enabled=true.`,
        );
      }
      ctx.log?.info(
        `[${account.accountId}] starting desktop-robot WS on ` +
          `ws://${account.bind}:${account.port}${account.path}`,
      );
      const server = await createDesktopRobotServer({
        account,
        cfg: ctx.cfg as Record<string, unknown>,
        log: ctx.log,
        abortSignal: ctx.abortSignal,
      });

      // Block until the gateway aborts. Returning from startAccount signals
      // "channel exited" to the framework, which triggers auto-restart.
      await new Promise<void>((resolve) => {
        if (ctx.abortSignal) {
          ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        }
      });

      ctx.log?.info(`[${account.accountId}] stopping desktop-robot WS server`);
      await server.stop();
    },
  },
};
