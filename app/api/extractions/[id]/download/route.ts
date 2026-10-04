import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";

/** Friendly pre-check (clear errors in the UI); the browser then navigates to /file to save it. */
async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminClient(runtime().env);
  const { data: job } = await db.from("extraction_jobs").select("id,order_id,status,result_size").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const { data: order } = job.order_id ? await db.from("orders").select("user_id,customer_token_hash").eq("id", job.order_id).maybeSingle() : { data: null };
  if (!(await canAccessOrder(order))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (job.status !== "COMPLETED") return NextResponse.json({ error: "Your file isn't ready yet." }, { status: 409 });
  if (!job.result_size) return NextResponse.json({ error: "This file has expired and was deleted. Contact support if you still need it." }, { status: 410 });
  await db.from("download_events").insert({ job_id: job.id, action: "DOWNLOADED" });
  return NextResponse.json({ url: new URL(`/api/extractions/${id}/file`, request.url).toString() });
}

export const GET = withApi(handleGET);
