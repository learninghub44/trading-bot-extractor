import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";
import { attachmentHeaders } from "@/lib/storage";

/** Streams the stored XML to the buyer's browser. Access = signed-in owner or this browser's guest cookie. */
async function handleGET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminClient(runtime().env);
  const { data: job } = await db.from("extraction_jobs").select("order_id,status,filename,result_xml").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const { data: order } = job.order_id ? await db.from("orders").select("user_id,customer_token_hash").eq("id", job.order_id).maybeSingle() : { data: null };
  if (!(await canAccessOrder(order))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (job.status !== "COMPLETED" || !job.result_xml) return NextResponse.json({ error: "This file isn't available." }, { status: 410 });
  return new Response(job.result_xml, { headers: attachmentHeaders(job.filename || "trading-bot.xml", "application/xml") });
}

export const GET = withApi(handleGET);
