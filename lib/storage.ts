import type { SupabaseClient } from "@supabase/supabase-js";
import { envNum, type AppEnv } from "./env";

/**
 * Results live in Postgres (extraction_jobs.result_xml) — no separate file store.
 * Privacy: delivered files are purged after RESULT_RETENTION_DAYS (default 30).
 */
export async function purgeExpiredResults(db: SupabaseClient, env: AppEnv): Promise<void> {
  const cutoff = new Date(Date.now() - envNum(env, "RESULT_RETENTION_DAYS", 30) * 24 * 3600_000).toISOString();
  const { error } = await db.from("extraction_jobs")
    .update({ result_xml: null, result_size: null })
    .lt("completed_at", cutoff).not("result_xml", "is", null);
  if (error) console.error("[purge] failed", error.message);
}

export function attachmentHeaders(filename: string, contentType: string) {
  return {
    "content-type": `${contentType}; charset=utf-8`,
    "content-disposition": `attachment; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
}
