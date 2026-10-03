import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";
import { signedDownloadPath } from "@/lib/storage";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env } = runtime();
  const db = adminClient(env);
  const { data: bulk } = await db.from("bulk_jobs").select("id,status,zip_key").eq("id", id).maybeSingle();
  if (!bulk) return NextResponse.json({ error: "Bulk job not found." }, { status: 404 });
  if (bulk.status !== "COMPLETED" || !bulk.zip_key) return NextResponse.json({ error: "Bulk download is not ready." }, { status: 409 });
  const { data: order } = await db.from("orders").select("user_id,customer_token_hash").eq("bulk_job_id", id).maybeSingle();
  if (!(await canAccessOrder(order))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { path, expiresIn } = signedDownloadPath(env, bulk.zip_key, `trading-bot-extractions-${id}.zip`, "application/zip");
  return NextResponse.json({ url: new URL(path, request.url).toString(), expiresIn });
}
