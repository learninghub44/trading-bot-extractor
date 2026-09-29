import { NextResponse } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/server";
import { packageByCode } from "@/lib/pricing";
import { randomUUID } from "crypto";

const schema = z.object({ packageCode: z.enum(["bulk10","bulk25","bulk50","bulk100"]), urls: z.array(z.string().url().max(2048)).min(1).max(100) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid bulk request." }, { status: 400 });
  const product = packageByCode(parsed.data.packageCode)!;
  if (parsed.data.urls.length > product.quantity) return NextResponse.json({ error: "Too many URLs for this package." }, { status: 400 });
  const db = adminClient(); const id = randomUUID();
  const { error } = await db.from("bulk_jobs").insert({ id, product_code: product.code, quantity: parsed.data.urls.length, amount_kes: product.priceKes, status: "PAYMENT_PENDING" });
  if (error) return NextResponse.json({ error: "Could not create bulk job." }, { status: 500 });
  await db.from("bulk_items").insert(parsed.data.urls.map((url, index) => ({ bulk_job_id: id, position: index + 1, source_url: url, status: "WAITING_FOR_PAYMENT" })));
  return NextResponse.json({ id, status: "PAYMENT_PENDING", amountKes: product.priceKes });
}
