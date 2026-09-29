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

  const { data: existing } = await db.from("webhook_events").select("id").eq("provider", "payhero").eq("event_key", eventKey).maybeSingle();
  if (existing) return NextResponse.json({ ok: true });

  await db.from("webhook_events").insert({
    provider: "payhero",
    event_key: eventKey,
    payload: body,
    payload_hash: payloadHash,
  });

  const success = body.status === "success" && body.success === true;
  const status = success ? "PAID" : "PAYMENT_FAILED";

  const { data: order } = await db.from("orders").select("id,amount_kes,status").eq("external_reference", reference).maybeSingle();
  if (order) {
    await db.from("payments").update({
      status: success ? "SUCCEEDED" : "FAILED",
      provider_reference: body.reference || body.transaction_id || null,
      paid_at: success ? new Date().toISOString() : null,
      callback_payload: body,
    }).eq("order_id", order.id);

    if (success) {
      await db.from("orders").update({ status }).eq("id", order.id).neq("status", "COMPLETED");
    } else {
      await db.from("orders").update({ status }).eq("id", order.id).in("status", ["PAYMENT_PENDING", "PAYMENT_PROCESSING"]);
    }
  }

  return NextResponse.json({ ok: true });
}
