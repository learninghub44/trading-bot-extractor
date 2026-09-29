import { NextResponse } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/server";
import { createPayHeroPayment } from "@/lib/payhero";
import { packageByCode } from "@/lib/pricing";
import { randomUUID } from "crypto";

const schema = z.object({
  packageCode: z.string().min(1),
  phone: z.string().regex(/^\+?254\d{9}$/),
  email: z.string().email().optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  bulkJobId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payment request." }, { status: 400 });
  const product = packageByCode(parsed.data.packageCode);
  if (!product) return NextResponse.json({ error: "Unknown package." }, { status: 400 });

  const db = adminClient();
  if (parsed.data.bulkJobId) {
    const { data: bulk } = await db.from("bulk_jobs").select("id,amount_kes,status").eq("id", parsed.data.bulkJobId).maybeSingle();
    if (!bulk || bulk.status !== "PAYMENT_PENDING" || bulk.amount_kes !== product.priceKes)
      return NextResponse.json({ error: "Bulk order is not payable." }, { status: 409 });
  }

  const orderId = randomUUID();
  const reference = `TBE-${orderId.replaceAll("-", "").slice(0, 20)}`;
  const { error } = await db.from("orders").insert({
    id: orderId, bulk_job_id: parsed.data.bulkJobId ?? null, product_code: product.code,
    quantity: product.quantity, amount_kes: product.priceKes, currency: "KES",
    status: "PAYMENT_PENDING", customer_phone: parsed.data.phone,
    customer_email: parsed.data.email ?? null, source_url: parsed.data.sourceUrl ?? null,
    external_reference: reference,
  });
  if (error) return NextResponse.json({ error: "Could not create order." }, { status: 500 });

  try {
    const payment = await createPayHeroPayment({
      reference, amount: product.priceKes, phone: parsed.data.phone,
      email: parsed.data.email, firstName: parsed.data.firstName, lastName: parsed.data.lastName,
      callbackUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/payhero`,
      redirectUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/payment/return?order=${orderId}`,
    });
    await db.from("payments").insert({
      order_id: orderId, provider: "payhero",
      provider_reference: payment?.merchant_reference || payment?.reference || null,
      amount_kes: product.priceKes, status: "PENDING", raw_response: payment,
    });
    return NextResponse.json({ orderId, reference, payment });
  } catch (error) {
    await db.from("orders").update({ status: "PAYMENT_FAILED", failure_reason: error instanceof Error ? error.message : "PAYMENT_ERROR" }).eq("id", orderId);
    return NextResponse.json({ error: "Payment request could not be started." }, { status: 502 });
  }
}
