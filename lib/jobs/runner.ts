import type { SupabaseClient } from "@supabase/supabase-js";
import { envNum, type AppEnv } from "../env";
import { adminClient } from "../server";
import { EngineError, toEngineError } from "../engine/errors";
import { extractFromUrl } from "../engine/extract";
import { purgeExpiredResults } from "../storage";
import { reconcilePaidOrders } from "./create";
import { reconcilePendingPayments } from "../payments/settle";

export type RunMode = "inline" | "cron";

interface Job { id: string; source_url: string | null; attempts: number }

const BACKOFF_SECONDS = [30, 120, 300];

/** A bulk job is complete once every item is settled; the ZIP is assembled on demand at download time. */
async function finishBulkIfReady(db: SupabaseClient, jobId: string) {
  const { data: link } = await db.from("bulk_items").select("bulk_job_id").eq("extraction_job_id", jobId).maybeSingle();
  if (!link) return;
  const { data: items } = await db.from("bulk_items").select("status").eq("bulk_job_id", link.bulk_job_id);
  if (!items?.length || items.some((i) => ["WAITING_FOR_PAYMENT", "PAID", "QUEUED", "EXTRACTING"].includes(i.status))) return;
  await db.from("bulk_jobs").update({ status: "COMPLETED", completed_at: new Date().toISOString() }).eq("id", link.bulk_job_id);
}

async function processJob(env: AppEnv, db: SupabaseClient, job: Job, workerId: string, mode: RunMode, budgetMs: number) {
  const started = Date.now();
  const maxAttempts = envNum(env, "MAX_JOB_ATTEMPTS", 3);
  try {
    if (!job.source_url) throw new EngineError("NO_SOURCE_URL");
    if (job.attempts > maxAttempts) throw new EngineError("MAX_ATTEMPTS_EXCEEDED");

    // Browser rendering is slow: allowed on the cron path, and on later attempts of any path.
    const result = await extractFromUrl(job.source_url, {
      env, allowBrowser: mode === "cron" || job.attempts >= 2, deadline: started + budgetMs,
    });
    const bytes = new TextEncoder().encode(result.xml);
    const { error: saveError } = await db.rpc("complete_extraction_job", {
      p_id: job.id, p_worker_id: workerId, p_status: "COMPLETED", p_result_xml: result.xml, p_filename: result.filename,
      p_bot_name: result.botName, p_sha256: result.sha256, p_size: bytes.byteLength,
    });
    if (saveError) throw new EngineError("RESULT_SAVE_FAILED", true, saveError.message);
    await db.from("extraction_attempts").insert({ job_id: job.id, adapter: result.strategy, strategy: result.strategy, status: "SUCCESS", duration_ms: Date.now() - started });
    await db.from("bulk_items").update({ status: "COMPLETED" }).eq("extraction_job_id", job.id);
  } catch (raw) {
    const error = toEngineError(raw);
    const noBrowserYet = error.code === "BOT_DATA_NOT_FOUND" && mode === "inline" && job.attempts < 2;
    const retry = (error.transient || noBrowserYet) && job.attempts < maxAttempts;
    await db.from("extraction_attempts").insert({
      job_id: job.id, adapter: "engine", strategy: "orchestrator", status: retry ? "RETRY" : "FAILED",
      duration_ms: Date.now() - started, error_code: error.code, metadata: { message: error.message.slice(0, 500), attempt: job.attempts },
    });
    if (retry) {
      // Back to PAID with a delay; the cron picks it up (next attempt may use browser rendering).
      const delay = noBrowserYet ? 0 : BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];
      await db.from("extraction_jobs").update({
        status: "PAID", lease_until: new Date(Date.now() + delay * 1000).toISOString(), worker_id: null,
        error_code: error.code, error_message: error.message.slice(0, 1000), updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("worker_id", workerId);
      return;
    }
    await db.rpc("complete_extraction_job", { p_id: job.id, p_worker_id: workerId, p_status: "FAILED", p_error_code: error.code, p_error_message: error.message.slice(0, 1000) });
    await db.from("bulk_items").update({ status: "FAILED", error_code: error.code, error_message: error.message.slice(0, 500) }).eq("extraction_job_id", job.id);
  }
  await finishBulkIfReady(db, job.id).catch((e) => console.error("bulk finish failed", e));
}

/** Claim and process due jobs. Safe to run concurrently: claiming uses row locks + leases. */
export async function runPendingJobs(env: AppEnv, opts: { mode: RunMode; limit?: number; budgetMs?: number }): Promise<number> {
  const db = adminClient(env);
  const workerId = `cf-${crypto.randomUUID().slice(0, 8)}`;
  const budgetMs = opts.budgetMs ?? (opts.mode === "cron" ? 100_000 : 25_000);
  if (opts.mode === "cron") {
    await reconcilePendingPayments(db, env).catch((e) => console.error("payment reconcile failed", e));
    await reconcilePaidOrders(db).catch((e) => console.error("reconcile failed", e));
    await purgeExpiredResults(db, env);
  }
  const { data: jobs, error } = await db.rpc("claim_extraction_jobs", { p_worker_id: workerId, p_limit: opts.limit ?? 3 });
  if (error) { console.error("claim failed", error.message); return 0; }
  await Promise.allSettled((jobs as Job[] ?? []).map((job) => processJob(env, db, job, workerId, opts.mode, budgetMs)));
  return (jobs as Job[] | null)?.length ?? 0;
}
