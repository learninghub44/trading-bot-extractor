"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/client";

type Job = { id: string; status: string; source_url: string | null; bot_name: string | null; filename: string | null; error_code: string | null };
type OrderState = { status: string; failureReason: string | null; jobs: Job[]; bulk: { id: string; status: string } | null };

const ERRORS: Record<string, string> = {
  BOT_DATA_NOT_FOUND: "We couldn't find a bot at that link.",
  SOURCE_HTTP_404: "That link no longer exists (404).",
  SOURCE_HTTP_403: "That link is private or blocked (403).",
  SOURCE_HTTP_401: "That link needs a login.",
  PRIVATE_DESTINATION_BLOCKED: "That address isn't allowed.",
  SOURCE_TIMEOUT: "The site took too long to respond.",
  SOURCE_TOO_LARGE: "That file is too large.",
  MAX_ATTEMPTS_EXCEEDED: "We tried several times without success.",
};

export default function PaymentReturn({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = use(searchParams);
  const [state, setState] = useState<OrderState | null>(null);
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);
  const [polls, setPolls] = useState(0);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (!order) return;
    let stop = false;
    const tick = async () => {
      const r = await callApi<OrderState>(`/api/orders/${order}`, { cache: "no-store" });
      if (r.status === 404) { setGone(true); stop = true; return; }
      if (r.ok && r.data) {
        setState(r.data);
        const d = r.data;
        if (d.status === "PAYMENT_FAILED" || (d.jobs.length > 0 && d.jobs.every((j) => j.status === "COMPLETED" || j.status === "FAILED"))) stop = true;
      }
      setPolls((n) => n + 1);
    };
    tick();
    const timer = setInterval(() => { if (stop) clearInterval(timer); else tick(); }, 3000);
    return () => { stop = true; clearInterval(timer); };
  }, [order]);

  const download = useCallback(async (url: string, id: string) => {
    setBusyId(id); setError("");
    const r = await callApi<{ url: string }>(url);
    setBusyId("");
    if (r.ok && r.data?.url) window.location.href = r.data.url; else setError(r.error || "Download failed. Please try again.");
  }, []);

  if (!order || gone) {
    return <main className="container page"><div className="narrow card"><h1 style={{ fontSize: 26 }}>Order not found</h1><p className="muted" style={{ margin: "10px 0 18px" }}>We can only show an order in the browser that placed it. Sign in to see your orders anywhere.</p><div className="row"><Link href="/dashboard" className="btn btn-dark btn-sm">My downloads</Link><Link href="/" className="btn btn-ghost btn-sm">Start over</Link></div></div></main>;
  }

  const paymentFailed = state?.status === "PAYMENT_FAILED";
  const waitingPay = !state || state.status === "PAYMENT_PENDING";
  const jobs = state?.jobs ?? [];
  const allDone = jobs.length > 0 && jobs.every((j) => j.status === "COMPLETED" || j.status === "FAILED");
  const failed = jobs.filter((j) => j.status === "FAILED");
  const stage = paymentFailed ? 0 : waitingPay ? 1 : allDone ? 3 : 2;

  return (
    <main className="container page">
      <div className="narrow">
        <section className="card">
          <div className="progress" aria-hidden>
            <div className={stage >= 2 ? "on" : stage === 1 ? "run" : ""} /><div className={stage >= 3 ? "on" : stage === 2 ? "run" : ""} /><div className={stage >= 3 ? "on" : ""} />
          </div>

          {paymentFailed ? (
            <>
              <h1 style={{ fontSize: 26 }}>Payment didn&apos;t go through</h1>
              <p className="muted" style={{ margin: "10px 0 18px" }}>{state?.failureReason ? "The M-Pesa request was declined or cancelled." : "The payment wasn't completed."} You haven&apos;t been charged for an extraction.</p>
              <Link href="/" className="btn btn-dark">Try again</Link>
            </>
          ) : waitingPay ? (
            <>
              <h1 style={{ fontSize: 26 }}>Approve the M-Pesa prompt</h1>
              <p className="muted" style={{ margin: "10px 0 14px" }}>Check your phone and enter your M-Pesa PIN. This page updates by itself the moment payment is confirmed.</p>
              <p className="row muted"><span className="spinner" /> Waiting for payment…</p>
              {polls > 30 && <div className="alert warn" style={{ marginTop: 16 }}>Still nothing after a while. If you already paid, keep this page open — or find your order later under <Link href="/dashboard"><b>My downloads</b></Link>.</div>}
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 26 }}>{allDone ? (failed.length === jobs.length ? "We couldn't extract it" : "Your bot is ready") : "Payment received — extracting"}</h1>
              {!allDone && <p className="muted" style={{ margin: "10px 0 6px" }}>This usually takes under a minute. If a site is slow we retry automatically.</p>}
              <div style={{ marginTop: 14 }}>
                {jobs.length === 0 && <p className="row muted"><span className="spinner" /> Starting your extraction…</p>}
                {jobs.map((j) => (
                  <div className="job" key={j.id}>
                    <div className="meta"><b>{j.bot_name || j.source_url || "Your bot"}</b>
                      <span>{j.status === "COMPLETED" ? j.filename : j.status === "FAILED" ? (ERRORS[j.error_code || ""] || "Extraction failed.") : j.status === "EXTRACTING" ? "Extracting…" : "Queued…"}</span></div>
                    {j.status === "COMPLETED" ? <button className="btn btn-dark btn-sm" disabled={busyId === j.id} onClick={() => download(`/api/extractions/${j.id}/download`, j.id)}>{busyId === j.id ? "…" : "Download XML"}</button>
                      : j.status === "FAILED" ? <span className="badge err">Failed</span> : <span className="badge info">In progress</span>}
                  </div>
                ))}
              </div>
              {state?.bulk?.status === "COMPLETED" && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => download(`/api/bulk/${state.bulk!.id}/download`, "bulk")}>Download everything (ZIP)</button>}
              {allDone && failed.length > 0 && <div className="alert info" style={{ marginTop: 16 }}>Have the bot file yourself? Upload it from <Link href="/dashboard"><b>My downloads</b></Link> — your payment still covers it.</div>}
            </>
          )}
          {error && <div className="alert error" role="alert" style={{ marginTop: 16 }}>{error}</div>}
        </section>
        <p className="help" style={{ textAlign: "center", marginTop: 14 }}>Order {order.slice(0, 8)} · <Link href="/dashboard">My downloads</Link></p>
      </div>
    </main>
  );
}
