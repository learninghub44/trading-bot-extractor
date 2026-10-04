import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { adminClient } from "@/lib/server";
import { envStr, runtime } from "@/lib/env";

async function handleGET() {
  const { env } = runtime();
  const checks: Record<string, string> = { api: "ok" };
  try { const { error } = await adminClient(env).from("system_health").select("name").limit(1); checks.database = error ? "error" : "ok"; }
  catch { checks.database = "error"; }
  checks.storage = env.RESULTS ? "ok" : "error";
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "PAYHERO_API_USERNAME", "PAYHERO_API_PASSWORD", "PAYHERO_PROVIDER", "PAYHERO_VENDOR_ID", "PAYHERO_NETWORK_ID",
    "PAYHERO_PROVIDER_ID", "PAYHERO_NETWORK_NAME", "PAYHERO_NETWORK_CODE", "PAYHERO_WEBHOOK_SECRET", "DOWNLOAD_SIGNING_SECRET",
  ];
  // Variable names are public (see .env.example); values are never returned.
  const missing = required.filter((k) => !envStr(env, k));
  checks.config = missing.length ? "error" : "ok";
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks, missing, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}

export const GET = withApi(handleGET);
