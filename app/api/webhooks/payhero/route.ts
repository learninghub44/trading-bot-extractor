import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { verifyCallbackSignature } from "@/lib/payhero";
import { createHash } from "crypto";

const ok = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object") return ok();
  const body = parsed as Record<string, unknown>;
  const reference = String(body.external_reference || "");
  if (!reference) return ok();

  // Authenticity: the callback URL we gave PayHero carries an HMAC of the order reference.
  const sig = new URL(request.url).searchParams.get("sig");
  if (!verifyCallbackSignature(reference, sig)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const db = adminClient();
  const now = () => new Date().toISOString();

  const { data: order } = await db
    .from("orders")
    .select("id,amount_kes,status,source_url,bulk_job_id")
    .eq("external_reference", reference)
    .maybeSingle();
  if (!order) return ok();

  // Audit log only. Idempotency comes from the atomic status transitions below,
  // so a retry after a partial failure is still processed instead of dropped.
  const eventKey = String(body.transaction_id || body.reference || reference);
  const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  await db.from("webhook_events").upsert(
    { provider: "payhero", event_key: eventKey, payload: body, payload_hash: payloadHash, processed_at: now() },
    { onConflict: "provider,event_key", ignoreDuplicates: true },
  );

  const success = body.status === "success" && body.success === true;

  if (!success) {
    const { data: failed } = await db
      .from("orders")
      .update({ status: "PAYMENT_FAILED", updated_at: now() })
      .eq("id", order.id)
      .eq("status", "PAYMENT_PENDING")
      .select("id");
    if (!failed?.length) return ok(); // already settled
    await db.from("payments").update({
      status: "FAILED",
      provider_reference: body.reference || body.transaction_id || null,
      callback_payload: body,
      updated_at: now(),
    }).eq("order_id", order.id);
    if (order.bulk_job_id) await db.from("bulk_jobs").update({ status: "PAYMENT_FAILED" }).eq("id", order.bulk_job_id);
    return ok();
  }

  // Never release a paid order for the wrong amount. Callbacks are already authenticated by the
  // signed URL; if PayHero omits the amount we can only warn.
  if (body.amount === undefined) console.warn("payhero webhook: no amount in callback", { reference });
  if (body.amount !== undefined && Number(body.amount) !== Number(order.amount_kes)) {
    await db.from("orders").update({ failure_reason: "AMOUNT_MISMATCH", updated_at: now() })
      .eq("id", order.id).eq("status", "PAYMENT_PENDING");
    return ok();
  }

  // Atomic PENDING/FAILED -> PAID; only the request that wins this transition creates jobs.
  const { data: claimed, error: claimError } = await db
    .from("orders")
    .update({ status: "PAID", updated_at: now() })
    .eq("id", order.id)
    .in("status", ["PAYMENT_PENDING", "PAYMENT_FAILED"])
    .select("id");
  if (claimError) return NextResponse.json({ error: "Temporary failure." }, { status: 500 }); // let PayHero retry
  if (!claimed?.length) return ok(); // already processed

  await db.from("payments").update({
    status: "SUCCEEDED",
    provider_reference: body.reference || body.transaction_id || null,
    paid_at: now(),
    callback_payload: body,
    updated_at: now(),
  }).eq("order_id", order.id);

  if (order.bulk_job_id) {
    await db.from("bulk_jobs").update({ status: "PAID" }).eq("id", order.bulk_job_id);
    const { data: items } = await db.from("bulk_items").select("id,source_url")
      .eq("bulk_job_id", order.bulk_job_id).eq("status", "WAITING_FOR_PAYMENT");
    if (items?.length) {
      const rows = items.map((item) => ({ source_url: item.source_url, status: "PAID", payment_status: "PAID", order_id: order.id }));
      const { data: jobs } = await db.from("extraction_jobs").insert(rows).select("id,source_url");
      for (const job of jobs ?? []) {
        await db.from("bulk_items")
          .update({ status: "QUEUED", extraction_job_id: job.id })
          .eq("id", items.find((i) => i.source_url === job.source_url)?.id);
      }
    }
  } else if (order.source_url) {
    await db.from("extraction_jobs").insert({
      order_id: order.id, source_url: order.source_url, source_type: "url",
      status: "PAID", payment_status: "PAID",
    });
  }

  return ok();
}
