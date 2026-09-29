import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
export async function GET() {
  const checks: Record<string,string> = { api: "ok" };
  try { const { error } = await adminClient().from("system_health").select("name").limit(1); checks.database = error ? "error" : "ok"; }
  catch { checks.database = "error"; }
  const healthy = Object.values(checks).every(v => v === "ok");
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
