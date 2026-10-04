import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { z } from "zod";
import { adminClient } from "@/lib/server";
import { runtime } from "@/lib/env";
import { assertPayHeroConfigured, createPayHeroPayment, signCallbackReference } from "@/lib/payhero";
import { packageByCode } from "@/lib/pricing";
import { normalizeKenyanPhone } from "@/lib/phone";
import { randomUUID, createHash } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  packageCode: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  bulkJobId: z.string().uuid().optional(),
});

async function handlePOST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const message = field === "sourceUrl" ? "Enter a valid bot link starting with https://" : field === "email" ? "That email address doesn't look right." : "Please check your details and try again.";
    return NextResponse.json({ error: message, code: "INVALID_REQUEST" }, { status: 400 });
  }
  const phone = normalizeKenyanPhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Enter a valid M-Pesa number, e.g. 0712 345 678.", code: "INVALID_PHONE" }, { status: 400 });
  const product = packageByCode(parsed.data.packageCode);
  if (!product) return NextResponse.json({ error: "Unknown package." }, { status: 400 });

  const { env } = runtime();
  assertPayHeroConfigured(env); // 503 before any order exists if payments aren't configured
  const db = adminClient(env);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const customerToken = randomUUID() + randomUUID();
  const customerTokenHash = createHash("sha256").update(customerToken).digest("hex");
  if (parsed.data.bulkJobId) {
    const { data: bulk } = await db.from("bulk_jobs").select("id,amount_kes,status").eq("id", parsed.data.bulkJobId).maybeSingle();
    if (!bulk || bulk.status !== "PAYMENT_PENDING" || bulk.amount_kes !== product.priceKes)
      return NextResponse.json({ error: "Bulk order is not payable." }, { status: 409 });
  }

  const orderId = randomUUID();
  const reference = `TBE-${orderId.replaceAll("-", "").slice(0, 20)}`;
  const { error } = await db.from("orders").insert({
    id: orderId, user_id: user?.id ?? null, customer_token_hash: customerTokenHash, bulk_job_id: parsed.data.bulkJobId ?? null, product_code: product.code,
    quantity: product.quantity, amount_kes: product.priceKes, currency: "KES",
    status: "PAYMENT_PENDING", customer_phone: phone,
    customer_email: parsed.data.email ?? null, source_url: parsed.data.sourceUrl ?? null,
    external_reference: reference,
  });
  if (error) { console.error("[orders insert]", error.message); return NextResponse.json({ error: "We couldn't start your order. Please try again.", code: "ORDER_FAILED" }, { status: 500 }); }

  // Insert the payment row before calling PayHero so a fast callback always finds it.
  const { data: paymentRow, error: paymentRowError } = await db.from("payments").insert({
    order_id: orderId, provider: "payhero", amount_kes: product.priceKes, status: "PENDING",
  }).select("id").single();
  if (paymentRowError || !paymentRow) {
    await db.from("orders").update({ status: "PAYMENT_FAILED", failure_reason: "PAYMENT_RECORD_ERROR" }).eq("id", orderId);
    return NextResponse.json({ error: "Could not create order." }, { status: 500 });
  }

  try {
    const site = String(env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
    const name = [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(" ");
    const payment = await createPayHeroPayment(env, {
      reference, amount: product.priceKes, phone, customerName: name || undefined,
      callbackUrl: `${site}/api/webhooks/payhero?sig=${signCallbackReference(env, reference)}`,
    });
    await db.from("payments").update({
      raw_response: payment, provider_reference: payment.reference ?? null, updated_at: new Date().toISOString(),
    }).eq("id", paymentRow.id);
    const cookieStore=await cookies();
    cookieStore.set("tbe_access", customerToken, {httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*30});
    return NextResponse.json({ orderId, reference, status: payment.status ?? "QUEUED" });
  } catch (error) {
    await db.from("orders").update({ status: "PAYMENT_FAILED", failure_reason: error instanceof Error ? error.message : "PAYMENT_ERROR" }).eq("id", orderId).eq("status", "PAYMENT_PENDING");
    await db.from("payments").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", paymentRow.id).eq("status", "PENDING");
    console.error("[payhero]", error instanceof Error ? error.message : error);
    await db.from("orders").update({ failure_reason: "PAYMENT_START_FAILED" }).eq("id", orderId);
    return NextResponse.json({ error: "We couldn't send the M-Pesa prompt. Check the number and try again.", code: "PAYMENT_START_FAILED" }, { status: 502 });
  }
}

export const POST = withApi(handlePOST);
