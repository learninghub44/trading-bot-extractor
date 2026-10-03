import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env } = runtime();
  const db = adminClient(env);
  const { data: job } = await db.from("extraction_jobs")
    .select("id,order_id,status,source_url,bot_name,filename,error_code,error_message,attempts,created_at,started_at,completed_at").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const { data: order } = job.order_id ? await db.from("orders").select("user_id,customer_token_hash").eq("id", job.order_id).maybeSingle() : { data: null };
  if (!(await canAccessOrder(order))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json(job);
}
