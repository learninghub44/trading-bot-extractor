import { getCloudflareContext } from "@opennextjs/cloudflare";

export class ConfigError extends Error {
  constructor(public missing: string) {
    super(`Missing environment variable: ${missing}`);
    this.name = "ConfigError";
  }
}

export type AppEnv = Record<string, unknown>;

export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export function envStr(env: AppEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function envNum(env: AppEnv, name: string, fallback: number): number {
  const value = Number(envStr(env, name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function requireStr(env: AppEnv, name: string): string {
  const value = envStr(env, name);
  if (!value) throw new ConfigError(name);
  return value;
}

/** Bindings + vars + secrets on Workers; falls back to process.env under `next dev`/tests. */
export function runtime(): { env: AppEnv; ctx?: WaitUntilCtx } {
  try {
    const { env, ctx } = getCloudflareContext();
    return { env: { ...(process.env as AppEnv), ...(env as unknown as AppEnv) }, ctx };
  } catch {
    return { env: process.env as AppEnv };
  }
}
