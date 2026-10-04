import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminClient(runtime().env);
  const { data: bulk } = await db.from("bulk_jobs").select("id,status").eq("id", id).maybeSingle();
  if (!bulk) return NextResponse.json({ error: "Bulk job not found." }, { status: 404 });
  const { data: order } = await db.from("orders").select("user_id,customer_token_hash").eq("bulk_job_id", id).maybeSingle();
  if (!(await canAccessOrder(order))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (bulk.status !== "COMPLETED") return NextResponse.json({ error: "Bulk download is not ready." }, { status: 409 });
  return NextResponse.json({ url: new URL(`/api/bulk/${id}/file`, request.url).toString() });
}

export const GET = withApi(handleGET);
