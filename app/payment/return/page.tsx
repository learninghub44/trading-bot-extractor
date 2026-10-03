"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";

type Job = { id: string; status: string; source_url: string | null; bot_name: string | null; filename: string | null; error_code: string | null };
type OrderState = { status: string; failureReason: string | null; jobs: Job[]; bulk: { id: string; status: string } | null };

const LABEL: Record<string, string> = {
  PAID: "Payment received — queued", EXTRACTING: "Extracting…", COMPLETED: "Ready", FAILED: "Could not extract",
};

export default function PaymentReturn({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = use(searchParams);
  const [state, setState] = useState<OrderState | null>(null);
  const [error, setError] = useState("");
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    if (!order) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/orders/${order}`, { cache: "no-store" });
        if (r.status === 404) { setError("We couldn't find this order in this browser session."); stop = true; return; }
        const d: OrderState = await r.json();
        setState(d);
        const jobsDone = d.jobs.length > 0 && d.jobs.every((j) => j.status === "COMPLETED" || j.status === "FAILED");
        if (d.status === "PAYMENT_FAILED" || jobsDone) stop = true;
      } catch { /* keep polling */ }
      setPolls((n) => n + 1);
    };
    tick();
    const timer = setInterval(() => { if (stop) clearInterval(timer); else tick(); }, 3000);
    return () => { stop = true; clearInterval(timer); };
  }, [order]);

  const download = useCallback(async (url: string) => {
    const r = await fetch(url);
    const d = await r.json();
    if (r.ok) window.location.href = d.url; else setError(d.error || "Download failed.");
  }, []);

  if (!order) return <main className="auth"><section className="panel"><h1>Missing order</h1><Link href="/">Back</Link></section></main>;

  const waiting = !state || state.status === "PAYMENT_PENDING";
  return (
    <main className="auth"><section className="panel">
      <p className="eyebrow">PAYMENT</p>
      <h1>{waiting ? "Waiting for your M-Pesa payment…" : state?.status === "PAYMENT_FAILED" ? "Payment failed" : "Payment received"}</h1>
      {waiting && <p>Approve the M-Pesa prompt on your phone. This page updates automatically{polls > 40 ? " — still waiting; if you already paid, keep this page open or check the dashboard." : "."}</p>}
      {state?.status === "PAYMENT_FAILED" && <p>{state.failureReason || "The payment was not completed."} Nothing was charged for extraction. <Link href="/">Try again</Link></p>}
      {state?.status === "PAID" && state.jobs.length === 0 && <p>Starting your extraction…</p>}
      {state?.jobs.map((j) => (
        <div key={j.id} style={{ margin: "12px 0" }}>
          <strong>{j.bot_name || j.source_url || j.id}</strong>
          <div>{LABEL[j.status] || j.status}{j.status === "FAILED" && j.error_code ? ` (${j.error_code})` : ""}</div>
          {j.status === "COMPLETED" && <button onClick={() => download(`/api/extractions/${j.id}/download`)}>Download XML</button>}
          {j.status === "FAILED" && <p>If the bot is a file you have, upload it from your dashboard instead — your payment still covers it.</p>}
        </div>
      ))}
      {state?.bulk?.status === "COMPLETED" && <button onClick={() => download(`/api/bulk/${state.bulk!.id}/download`)}>Download all (ZIP)</button>}
      {error && <p className="notice">{error}</p>}
      <p>Order: {order}</p>
      <Link href="/dashboard">Open dashboard</Link>
    </section></main>
  );
}
