import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { randomUUID } from "crypto";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { envNum, runtime } from "@/lib/env";
import { extractFromUpload } from "@/lib/engine/extract";
import { toEngineError } from "@/lib/engine/errors";

async function handlePOST(request: Request) {
  const { env } = runtime();
  const form = await request.formData();
  const file = form.get("file");
  const orderId = String(form.get("orderId") || "");
  if (!(file instanceof File) || !orderId) return NextResponse.json({ error: "File and paid order are required." }, { status: 400 });
  if (file.size > envNum(env, "MAX_UPLOAD_BYTES", 10485760)) return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });

  const db = adminClient(env);
  const { data: order } = await db.from("orders").select("id,status,quantity,user_id,customer_token_hash").eq("id", orderId).maybeSingle();
  if (!order || !(await canAccessOrder(order))) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  if (order.status !== "PAID") return NextResponse.json({ error: "ORDER_NOT_PAID" }, { status: 402 });

  // Paid quota: failed jobs don't consume it, so a failed URL extraction can be rescued by uploading the file.
  const { count } = await db.from("extraction_jobs").select("id", { count: "exact", head: true }).eq("order_id", orderId).neq("status", "FAILED");
  if ((count ?? 0) >= order.quantity) return NextResponse.json({ error: "QUOTA_EXCEEDED" }, { status: 409 });

  const jobId = randomUUID();
  try {
    const result = await extractFromUpload(new Uint8Array(await file.arrayBuffer()), file.name);
    const now = new Date().toISOString();
    await db.from("extraction_jobs").insert({
      id: jobId, order_id: orderId, status: "COMPLETED", payment_status: "PAID", source_type: "upload", bot_name: result.botName,
      filename: result.filename, result_xml: result.xml, result_sha256: result.sha256, result_size: result.size, validation_status: "VALID",
      adapter: result.strategy, started_at: now, completed_at: now,
    });
    return NextResponse.json({ id: jobId, status: "COMPLETED", filename: result.filename });
  } catch (raw) {
    const error = toEngineError(raw);
    await db.from("extraction_jobs").insert({ id: jobId, order_id: orderId, status: "FAILED", payment_status: "PAID", source_type: "upload", error_code: error.code });
    return NextResponse.json({ error: error.code }, { status: 422 });
  }
}

export const POST = withApi(handlePOST);
