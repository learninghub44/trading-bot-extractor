import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv, WaitUntilCtx } from "../env";
import { createJobsForPaidOrder } from "../jobs/create";
import { runPendingJobs } from "../jobs/runner";
import { getPayHeroStatus, normalizeStatus } from "../payhero";

export interface Outcome {
  reference: string; // our external_reference
  success: boolean;
  amount?: number;
  receipt?: string;
  payload: unknown;
  source: "callback" | "poll";
}

const now = () => new Date().toISOString();

/**
 * Single place that moves an order PENDING -> PAID/FAILED. Used by the webhook and by polling,
 * so a lost callback can never leave a paid customer without their extraction.
 * Idempotent: only the caller that wins the atomic status transition creates jobs.
 */
export async function settlePayment(db: SupabaseClient, env: AppEnv, ctx: WaitUntilCtx | undefined, o: Outcome): Promise<string> {
  const { data: order } = await db.from("orders")
    .select("id,amount_kes,status,source_url,bulk_job_id").eq("external_reference", o.reference).maybeSingle();
  if (!order) return "unknown_order";

  const payload = (o.payload && typeof o.payload === "object" ? o.payload : {}) as Record<string, unknown>;

  if (!o.success) {
    const { data: failed } = await db.from("orders").update({ status: "PAYMENT_FAILED", failure_reason: "PAYMENT_DECLINED", updated_at: now() })
      .eq("id", order.id).eq("status", "PAYMENT_PENDING").select("id");
    if (!failed?.length) return "already_settled";
    await db.from("payments").update({ status: "FAILED", callback_payload: payload, updated_at: now() }).eq("order_id", order.id);
    if (order.bulk_job_id) await db.from("bulk_jobs").update({ status: "PAYMENT_FAILED" }).eq("id", order.bulk_job_id);
    return "failed";
  }

  // Never release a paid order for the wrong amount.
  if (o.amount !== undefined && Number(o.amount) !== Number(order.amount_kes)) {
    await db.from("orders").update({ failure_reason: "AMOUNT_MISMATCH", updated_at: now() }).eq("id", order.id).eq("status", "PAYMENT_PENDING");
    console.error("[payments] amount mismatch", { reference: o.reference, paid: o.amount, expected: order.amount_kes });
    return "amount_mismatch";
  }

  const { data: claimed, error } = await db.from("orders").update({ status: "PAID", failure_reason: null, updated_at: now() })
    .eq("id", order.id).in("status", ["PAYMENT_PENDING", "PAYMENT_FAILED"]).select("id");
  if (error) throw new Error(`order claim failed: ${error.message}`);
  if (!claimed?.length) return "already_settled";

  await db.from("payments").update({
    status: "SUCCEEDED", paid_at: now(), callback_payload: { ...payload, source: o.source, receipt: o.receipt ?? null }, updated_at: now(),
  }).eq("order_id", order.id);

  try {
    await createJobsForPaidOrder(db, order);
  } catch (e) {
    console.error("[payments] job creation failed; cron will reconcile", e);
  }
  ctx?.waitUntil(runPendingJobs(env, { mode: "inline" }).catch((e) => console.error("[payments] inline run failed", e)));
  return "paid";
}

/** Ask PayHero about one pending order (throttled) — heals lost/slow callbacks. */
export async function reconcileOrderPayment(db: SupabaseClient, env: AppEnv, ctx: WaitUntilCtx | undefined, orderId: string, minAgeMs = 15_000): Promise<string> {
  const { data: order } = await db.from("orders").select("id,status,external_reference,created_at").eq("id", orderId).maybeSingle();
  if (!order || order.status !== "PAYMENT_PENDING" || Date.now() - new Date(order.created_at).getTime() < minAgeMs) return "skip";
  const { data: payment } = await db.from("payments").select("id,provider_reference,updated_at,status").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!payment?.provider_reference || payment.status !== "PENDING") return "skip";
  if (Date.now() - new Date(payment.updated_at).getTime() < 8_000) return "throttled";

  await db.from("payments").update({ updated_at: now() }).eq("id", payment.id);
  let data: unknown;
  try { data = await getPayHeroStatus(env, payment.provider_reference); } catch (e) { console.error("[payments] status lookup failed", e instanceof Error ? e.message : e); return "lookup_failed"; }
  const s = normalizeStatus(data);
  if (s.state === "pending") { if (s.raw && !["QUEUED", "PENDING", "PROCESSING"].includes(s.raw)) console.warn("[payments] unrecognised PayHero status", s.raw); return "pending"; }
  return settlePayment(db, env, ctx, { reference: order.external_reference, success: s.state === "success", amount: s.amount, payload: data, source: "poll" });
}

/** Cron: poll recent pending orders, and expire abandoned ones after 24h. */
export async function reconcilePendingPayments(db: SupabaseClient, env: AppEnv, ctx?: WaitUntilCtx): Promise<void> {
  const { data: pending } = await db.from("orders").select("id,created_at").eq("status", "PAYMENT_PENDING")
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()).lte("created_at", new Date(Date.now() - 45_000).toISOString()).limit(20);
  for (const o of pending ?? []) await reconcileOrderPayment(db, env, ctx, o.id, 0).catch((e) => console.error("[payments] reconcile failed", e));
  await db.from("orders").update({ status: "PAYMENT_FAILED", failure_reason: "PAYMENT_TIMEOUT", updated_at: now() })
    .eq("status", "PAYMENT_PENDING").lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
}
