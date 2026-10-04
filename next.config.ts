import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

// Public values are inlined into the browser bundle at build time. Defaults keep the browser login working
// even if the Cloudflare *build* variables are missing (the anon key is public by design; RLS protects data).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "https://bot.christech.co.ke",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ikvsufpannlhiiqnlosu.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_5nM7BHAspFrXn29WewnjgQ_mg8QzQxS",
  },
};
export default nextConfig;
