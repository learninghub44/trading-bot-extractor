import { NextResponse } from "next/server";
import { strToU8, zipSync } from "fflate";
import { withApi } from "@/lib/api";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";
import { attachmentHeaders } from "@/lib/storage";

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const MAX_ZIP_INPUT = 40 * 1024 * 1024;

/** Builds the ZIP on demand from the stored XML files — nothing extra to store or clean up. */
async function handleGET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminClient(runtime().env);
  const { data: bulk } = await db.from("bulk_jobs").select("id,status").eq("id", id).maybeSingle();
  if (!bulk) return NextResponse.json({ error: "Bulk job not found." }, { status: 404 });
  const { data: order } = await db.from("orders").select("user_id,customer_token_hash").eq("bulk_job_id", id).maybeSingle();
  if (!(await canAccessOrder(order))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (bulk.status !== "COMPLETED") return NextResponse.json({ error: "Bulk download is not ready." }, { status: 409 });

  const { data: items } = await db.from("bulk_items").select("position,source_url,status,extraction_job_id,error_code,error_message").eq("bulk_job_id", id).order("position");
  const files: Record<string, Uint8Array> = {};
  const rows = [["position", "source_url", "status", "filename", "error"].map(csv).join(",")];
  let total = 0;
  for (const item of items ?? []) {
    let added = "";
    if (item.status === "COMPLETED" && item.extraction_job_id) {
      const { data: job } = await db.from("extraction_jobs").select("filename,result_xml").eq("id", item.extraction_job_id).maybeSingle();
      if (job?.result_xml && total + job.result_xml.length <= MAX_ZIP_INPUT) {
        added = `${String(item.position).padStart(3, "0")}-${job.filename || "trading-bot.xml"}`;
        files[added] = strToU8(job.result_xml);
        total += job.result_xml.length;
      }
    }
    rows.push([item.position, item.source_url, added ? "COMPLETED" : "FAILED", added, added ? "" : item.error_message || item.error_code || "NOT_AVAILABLE"].map(csv).join(","));
  }
  files["manifest.csv"] = strToU8(rows.join("\n"));
  return new Response(zipSync(files) as unknown as BodyInit, { headers: { ...attachmentHeaders(`trading-bot-extractions-${id.slice(0, 8)}.zip`, "application/zip"), "content-type": "application/zip" } });
}

export const GET = withApi(handleGET);
