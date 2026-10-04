import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";
import { signedDownloadPath } from "@/lib/storage";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env } = runtime();
  const db = adminClient(env);
  const { data: job } = await db.from("extraction_jobs").select("id,order_id,status,result_key,filename").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "COMPLETED" || !job.result_key) return NextResponse.json({ error: "Download is not available." }, { status: 409 });
  const { data: order } = job.order_id ? await db.from("orders").select("user_id,customer_token_hash").eq("id", job.order_id).maybeSingle() : { data: null };
  if (!(await canAccessOrder(order))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { path, expiresIn } = signedDownloadPath(env, job.result_key, job.filename || "trading-bot.xml");
  await db.from("download_events").insert({ job_id: job.id, action: "LINK_ISSUED" });
  return NextResponse.json({ url: new URL(path, request.url).toString(), expiresIn });
}

export const GET = withApi(handleGET);
