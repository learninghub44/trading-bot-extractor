import { createClient } from "@supabase/supabase-js";
import { ConfigError, requireStr, type AppEnv } from "./env";

export function adminClient(env: AppEnv = process.env as AppEnv) {
  return createClient(requireStr(env, "NEXT_PUBLIC_SUPABASE_URL"), requireStr(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new ConfigError(name);
  return value;
}
