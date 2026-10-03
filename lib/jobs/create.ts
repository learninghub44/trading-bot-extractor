import type { SupabaseClient } from "@supabase/supabase-js";

type Order = { id: string; source_url: string | null; bulk_job_id: string | null };

/**
 * Create extraction jobs for a PAID order. Idempotent: job ids are derived from the order / bulk item id
 * and inserts ignore duplicates, so the webhook, retries and the cron reconciler can all call it safely.
 */
export async function createJobsForPaidOrder(db: SupabaseClient, order: Order): Promise<number> {
  let created = 0;
  if (order.bulk_job_id) {
    await db.from("bulk_jobs").update({ status: "PAID" }).eq("id", order.bulk_job_id).eq("status", "PAYMENT_PENDING");
    const { data: items } = await db.from("bulk_items").select("id,source_url").eq("bulk_job_id", order.bulk_job_id).eq("status", "WAITING_FOR_PAYMENT");
    for (const item of items ?? []) {
      const { error } = await db.from("extraction_jobs").upsert(
        { id: item.id, order_id: order.id, source_url: item.source_url, source_type: "url", status: "PAID", payment_status: "PAID" },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`job insert failed: ${error.message}`);
      await db.from("bulk_items").update({ status: "QUEUED", extraction_job_id: item.id }).eq("id", item.id).eq("status", "WAITING_FOR_PAYMENT");
      created++;
    }
  } else if (order.source_url) {
    const { error } = await db.from("extraction_jobs").upsert(
      { id: order.id, order_id: order.id, source_url: order.source_url, source_type: "url", status: "PAID", payment_status: "PAID" },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`job insert failed: ${error.message}`);
    created++;
  }
  return created;
}

/** Heal orders that were marked PAID but never got jobs (e.g. the webhook crashed mid-way). */
export async function reconcilePaidOrders(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  const { data: orders } = await db.from("orders").select("id,source_url,bulk_job_id").eq("status", "PAID").gte("created_at", since).limit(100);
  let created = 0;
  for (const order of orders ?? []) created += await createJobsForPaidOrder(db, order);
  return created;
}
