import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { DesktopRobotAccountConfig } from "./config-schema.js";

// Minimal overlay on OpenClawConfig — we only read our own section.
export type CoreConfig = {
  channels?: {
    "desktop-robot"?: DesktopRobotAccountConfig & {
      accounts?: Record<string, DesktopRobotAccountConfig | undefined>;
    };
  };
  session?: { store?: string };
  [key: string]: unknown;
};

export type ResolvedDesktopRobotAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  port: number;
  bind: string;
  path: string;
  config: DesktopRobotAccountConfig;
};

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.["desktop-robot"]?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  const ids = new Set<string>();
  for (const key of Object.keys(accounts)) {
    if (key.trim()) ids.add(normalizeAccountId(key));
  }
  return [...ids];
}

function resolveAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): DesktopRobotAccountConfig | undefined {
  const accounts = cfg.channels?.["desktop-robot"]?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  const direct = accounts[accountId];
  if (direct) return direct;
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((k) => normalizeAccountId(k) === normalized);
  return matchKey ? accounts[matchKey] : undefined;
}

function mergeAccountConfig(cfg: CoreConfig, accountId: string): DesktopRobotAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.["desktop-robot"] ??
    {}) as DesktopRobotAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function listDesktopRobotAccountIds(cfg: CoreConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  return ids.length === 0 ? [DEFAULT_ACCOUNT_ID] : ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultDesktopRobotAccountId(cfg: CoreConfig): string {
  const ids = listDesktopRobotAccountIds(cfg);
  return ids.includes(DEFAULT_ACCOUNT_ID) ? DEFAULT_ACCOUNT_ID : (ids[0] ?? DEFAULT_ACCOUNT_ID);
}

export function resolveDesktopRobotAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedDesktopRobotAccount {
  const normalized = normalizeAccountId(params.accountId);
  const merged = mergeAccountConfig(params.cfg, normalized);
  const baseEnabled = params.cfg.channels?.["desktop-robot"]?.enabled !== false;
  const accountEnabled = merged.enabled !== false;

  const port = merged.serve?.port ?? 18790;
  const bind = merged.serve?.bind ?? "127.0.0.1";
  const wsPath = merged.serve?.path ?? "/desktop-robot";

  // Considered "configured" when enabled — no external credentials needed.
  const configured = baseEnabled && accountEnabled;

  return {
    accountId: normalized,
    enabled: baseEnabled && accountEnabled,
    name: merged.name?.trim() || undefined,
    configured,
    port,
    bind,
    path: wsPath,
    config: merged,
  };
}
