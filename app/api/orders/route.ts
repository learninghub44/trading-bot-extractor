import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { cookies } from "next/headers";
import { withApi } from "@/lib/api";
import { runtime } from "@/lib/env";
import { adminClient } from "@/lib/server";
import { createClient } from "@/lib/supabase/server";

/** Orders (with their jobs) for the signed-in user and/or this browser's guest cookie. */
async function handleGET() {
  const db = adminClient(runtime().env);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const token = (await cookies()).get("tbe_access")?.value;
  const hash = token ? createHash("sha256").update(token).digest("hex") : null;

  const filters: string[] = [];
  if (user?.id) filters.push(`user_id.eq.${user.id}`);
  if (hash) filters.push(`customer_token_hash.eq.${hash}`);
  if (!filters.length) return NextResponse.json({ signedIn: false, orders: [] });

  const { data: orders } = await db.from("orders")
    .select("id,status,product_code,quantity,amount_kes,source_url,bulk_job_id,created_at")
    .or(filters.join(",")).order("created_at", { ascending: false }).limit(30);
  const ids = (orders ?? []).map((o) => o.id);
  const { data: jobs } = ids.length
    ? await db.from("extraction_jobs").select("id,order_id,status,source_url,bot_name,filename,error_code").in("order_id", ids)
    : { data: [] };
  return NextResponse.json({
    signedIn: Boolean(user),
    orders: (orders ?? []).map((o) => ({ ...o, jobs: (jobs ?? []).filter((j) => j.order_id === o.id) })),
  });
}

export const GET = withApi(handleGET);
