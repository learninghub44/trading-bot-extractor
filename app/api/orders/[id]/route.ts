import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";
import { createJobsForPaidOrder } from "@/lib/jobs/create";
import { runPendingJobs } from "@/lib/jobs/runner";

/** Order + job status for the payment-return page. Also nudges stuck jobs (safety net next to the cron). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env, ctx } = runtime();
  const db = adminClient(env);
  const { data: order } = await db.from("orders")
    .select("id,status,failure_reason,user_id,customer_token_hash,source_url,bulk_job_id,quantity").eq("id", id).maybeSingle();
  if (!order || !(await canAccessOrder(order))) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  if (order.status === "PAID") await createJobsForPaidOrder(db, order).catch(() => undefined);
  const { data: jobs } = await db.from("extraction_jobs")
    .select("id,status,source_url,bot_name,filename,error_code,error_message,created_at,lease_until").eq("order_id", id).order("created_at");
  const now = Date.now();
  const stuck = (jobs ?? []).some((j) => j.status === "PAID" && (!j.lease_until || new Date(j.lease_until).getTime() < now) && now - new Date(j.created_at).getTime() > 20_000);
  if (stuck) ctx?.waitUntil(runPendingJobs(env, { mode: "inline" }).catch(() => 0));

  const { data: bulk } = order.bulk_job_id ? await db.from("bulk_jobs").select("id,status").eq("id", order.bulk_job_id).maybeSingle() : { data: null };
  return NextResponse.json({
    orderId: order.id, status: order.status, failureReason: order.failure_reason, bulk,
    jobs: (jobs ?? []).map(({ lease_until, ...j }) => { void lease_until; return j; }),
  });
}
