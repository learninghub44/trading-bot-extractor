import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { signedDownload } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminClient();
  const { data: job } = await db.from("extraction_jobs").select("id,status,result_key,filename").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "COMPLETED" || !job.result_key) return NextResponse.json({ error: "Download is not available." }, { status: 409 });

  const url = await signedDownload(job.result_key, job.filename || "trading-bot.xml");
  await db.from("download_events").insert({ job_id: id, action: "SIGNED_URL_ISSUED" });
  return NextResponse.json({ url, expiresIn: Number(process.env.DOWNLOAD_TTL_SECONDS || 900) });
}
