import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { envStr, runtime } from "@/lib/env";

export async function GET() {
  const { env } = runtime();
  const checks: Record<string, string> = { api: "ok" };
  try { const { error } = await adminClient(env).from("system_health").select("name").limit(1); checks.database = error ? "error" : "ok"; }
  catch { checks.database = "error"; }
  checks.storage = env.RESULTS ? "ok" : "error";
  checks.secrets = ["PAYHERO_WEBHOOK_SECRET", "DOWNLOAD_SIGNING_SECRET", "SUPABASE_SERVICE_ROLE_KEY"].every((k) => envStr(env, k)) ? "ok" : "error";
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
