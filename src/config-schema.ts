import { DmPolicySchema } from "openclaw/plugin-sdk";
import { z } from "zod";

export const DesktopRobotServeSchema = z
  .object({
    port: z.number().int().min(1).max(65535).optional().default(18790),
    bind: z.string().optional().default("127.0.0.1"),
    path: z.string().optional().default("/desktop-robot"),
  })
  .strict();

export const DesktopRobotAuthSchema = z
  .object({
    token: z.string().optional(),
    allowAnonymous: z.boolean().optional().default(false),
  })
  .strict();

export const DesktopRobotSessionSchema = z
  .object({
    idleTimeoutMs: z.number().int().min(0).optional().default(1_800_000),
    maxSessions: z.number().int().min(1).optional().default(5),
  })
  .strict();

export const DesktopRobotStreamingSchema = z
  .object({
    minChunkChars: z.number().int().min(1).optional().default(10),
    flushIntervalMs: z.number().int().min(10).optional().default(100),
  })
  .strict();

export const DesktopRobotAccountSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    serve: DesktopRobotServeSchema.optional(),
    auth: DesktopRobotAuthSchema.optional(),
    session: DesktopRobotSessionSchema.optional(),
    streaming: DesktopRobotStreamingSchema.optional(),
    responseModel: z.string().optional(),
    responseSystemPrompt: z.string().optional(),
    /** Agent ID for tool policy isolation. Defaults to "desktop-robot". */
    agentId: z.string().optional().default("desktop-robot"),
    /** Allowed tools for the voice agent. Empty = no tools (fastest).
     *  Example: ["sessions_spawn", "cron"] */
    tools: z.array(z.string()).optional().default([]),
    dmPolicy: DmPolicySchema.optional().default("open"),
    allowFrom: z.array(z.string()).optional(),
  })
  .strict();

export const DesktopRobotConfigSchema = DesktopRobotAccountSchema.extend({
  accounts: z.record(z.string(), DesktopRobotAccountSchema.optional()).optional(),
});

export type DesktopRobotConfig = z.infer<typeof DesktopRobotConfigSchema>;
export type DesktopRobotAccountConfig = z.infer<typeof DesktopRobotAccountSchema>;
