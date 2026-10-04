import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { withApi } from "@/lib/api";
import { runtime } from "@/lib/env";
import { adminClient } from "@/lib/server";
import { parseCallback, verifyCallbackSignature } from "@/lib/payhero";
import { settlePayment } from "@/lib/payments/settle";

const ok = () => NextResponse.json({ ok: true });

async function handlePOST(request: Request) {
  const { env, ctx } = runtime();
  const body: unknown = await request.json().catch(() => null);
  const info = parseCallback(body);
  if (!info) return ok();

  // Authenticity: the callback URL we gave PayHero carries an HMAC of the order reference.
  if (!verifyCallbackSignature(env, info.reference, new URL(request.url).searchParams.get("sig"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const db = adminClient(env);
  // Audit log only; idempotency comes from the atomic order transition inside settlePayment.
  await db.from("webhook_events").upsert({
    provider: "payhero", event_key: info.checkoutRequestId || info.receipt || info.reference, payload: body,
    payload_hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"), processed_at: new Date().toISOString(),
  }, { onConflict: "provider,event_key", ignoreDuplicates: true });

  if (info.success && info.amount === undefined) console.warn("[payhero webhook] no Amount in callback", { reference: info.reference });
  await settlePayment(db, env, ctx, { reference: info.reference, success: info.success, amount: info.amount, receipt: info.receipt, payload: body, source: "callback" });
  return ok();
}

export const POST = withApi(handlePOST);
