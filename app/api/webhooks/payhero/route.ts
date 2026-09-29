import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { createHash } from "crypto";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ ok: true });
  const reference = String((body as any).external_reference || "");
  if (!reference) return NextResponse.json({ ok: true });

  const db = adminClient();
  const eventKey = String((body as any).transaction_id || (body as any).reference || reference);
  const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const { data: existing } = await db.from("webhook_events").select("id").eq("provider","payhero").eq("event_key",eventKey).maybeSingle();
  if (existing) return NextResponse.json({ ok: true });

  const { error: eventError } = await db.from("webhook_events").insert({
    provider:"payhero", event_key:eventKey, payload:body, payload_hash:payloadHash, processed_at:new Date().toISOString()
  });
  if (eventError && !String(eventError.message).includes("duplicate")) return NextResponse.json({ ok:true });

  const { data: order } = await db.from("orders").select("id,amount_kes,status,source_url,bulk_job_id").eq("external_reference",reference).maybeSingle();
  if (!order) return NextResponse.json({ ok:true });

  const success = body.status === "success" && body.success === true;
  await db.from("payments").update({
    status: success ? "SUCCEEDED":"FAILED",
    provider_reference: body.reference || body.transaction_id || null,
    paid_at: success ? new Date().toISOString():null,
    callback_payload: body,
    updated_at: new Date().toISOString()
  }).eq("order_id",order.id);

  if (!success) {
    await db.from("orders").update({status:"PAYMENT_FAILED",updated_at:new Date().toISOString()}).eq("id",order.id);
    if (order.bulk_job_id) await db.from("bulk_jobs").update({status:"PAYMENT_FAILED"}).eq("id",order.bulk_job_id);
    return NextResponse.json({ok:true});
  }

  await db.from("orders").update({status:"PAID",updated_at:new Date().toISOString()}).eq("id",order.id);

  if (order.bulk_job_id) {
    await db.from("bulk_jobs").update({status:"PAID"}).eq("id",order.bulk_job_id);
    const { data: items } = await db.from("bulk_items").select("id,source_url").eq("bulk_job_id",order.bulk_job_id).eq("status","WAITING_FOR_PAYMENT");
    if (items?.length) {
      const rows=items.map(item=>({source_url:item.source_url,status:"PAID",payment_status:"PAID",order_id:order.id}));
      const { data: jobs }=await db.from("extraction_jobs").insert(rows).select("id,source_url");
      if (jobs?.length) {
        for (const job of jobs) await db.from("bulk_items").update({status:"QUEUED",extraction_job_id:job.id}).eq("id",items.find(i=>i.source_url===job.source_url)?.id);
      }
    }
  } else if (order.source_url) {
    await db.from("extraction_jobs").insert({
      order_id:order.id, source_url:order.source_url, source_type:"url",
      status:"PAID", payment_status:"PAID"
    });
  }

  return NextResponse.json({ok:true});
}
