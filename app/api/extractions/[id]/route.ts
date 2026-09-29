import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminClient();
  const { data, error } = await db.from("extraction_jobs").select("id,status,source_url,bot_name,filename,error_code,error_message,created_at,started_at,completed_at").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load job." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json(data);
}
