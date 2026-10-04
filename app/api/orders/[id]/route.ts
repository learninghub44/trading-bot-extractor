import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { adminClient } from "@/lib/server";
import { canAccessOrder } from "@/lib/access";
import { runtime } from "@/lib/env";
import { createJobsForPaidOrder } from "@/lib/jobs/create";
import { runPendingJobs } from "@/lib/jobs/runner";
import { reconcileOrderPayment } from "@/lib/payments/settle";

/** Order + job status for the payment-return page. Also nudges stuck jobs (safety net next to the cron). */
async function handleGET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env, ctx } = runtime();
  const db = adminClient(env);
  const { data: order } = await db.from("orders")
    .select("id,status,failure_reason,user_id,customer_token_hash,source_url,bulk_job_id,quantity").eq("id", id).maybeSingle();
  if (!order || !(await canAccessOrder(order))) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  let current = order;
  if (order.status === "PAYMENT_PENDING") {
    // Lost or slow callback? Ask PayHero directly (throttled), so the buyer is never stuck.
    await reconcileOrderPayment(db, env, ctx, id).catch(() => undefined);
    const { data: fresh } = await db.from("orders").select("id,status,failure_reason,user_id,customer_token_hash,source_url,bulk_job_id,quantity").eq("id", id).maybeSingle();
    if (fresh) current = fresh;
  }
  if (current.status === "PAID") await createJobsForPaidOrder(db, current).catch(() => undefined);
  const { data: jobs } = await db.from("extraction_jobs")
    .select("id,status,source_url,bot_name,filename,error_code,error_message,created_at,lease_until").eq("order_id", id).order("created_at");
  const now = Date.now();
  const stuck = (jobs ?? []).some((j) => j.status === "PAID" && (!j.lease_until || new Date(j.lease_until).getTime() < now) && now - new Date(j.created_at).getTime() > 20_000);
  if (stuck) ctx?.waitUntil(runPendingJobs(env, { mode: "inline" }).catch(() => 0));

  const { data: bulk } = current.bulk_job_id ? await db.from("bulk_jobs").select("id,status").eq("id", current.bulk_job_id).maybeSingle() : { data: null };
  return NextResponse.json({
    orderId: current.id, status: current.status, failureReason: current.failure_reason, bulk,
    jobs: (jobs ?? []).map(({ lease_until, ...j }) => { void lease_until; return j; }),
  });
}

export const GET = withApi(handleGET);
