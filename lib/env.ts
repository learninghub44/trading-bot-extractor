import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Minimal R2 surface we use; avoids pulling Workers global types into the Next build. */
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; arrayBuffer(): Promise<ArrayBuffer>; size: number } | null>;
  delete(key: string): Promise<void>;
}

export type AppEnv = Record<string, unknown> & { RESULTS?: R2BucketLike };

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
  if (!value) throw new Error(`Missing environment variable: ${name}`);
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

export function bucket(env: AppEnv): R2BucketLike {
  if (!env.RESULTS) throw new Error("R2 binding RESULTS is not configured.");
  return env.RESULTS;
}
