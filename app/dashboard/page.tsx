"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/client";

type Job = { id: string; status: string; source_url: string | null; bot_name: string | null; filename: string | null };
type Order = { id: string; status: string; product_code: string; amount_kes: number; created_at: string; bulk_job_id: string | null; quantity: number; jobs: Job[] };

const STATUS: Record<string, [string, string]> = {
  PAYMENT_PENDING: ["Awaiting payment", "warn"], PAYMENT_FAILED: ["Payment failed", "err"], PAID: ["Paid", "info"],
};

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const r = await callApi<{ orders: Order[]; signedIn: boolean }>("/api/orders", { cache: "no-store" });
    if (r.ok && r.data) { setOrders(r.data.orders); setSignedIn(r.data.signedIn); } else { setError(r.error || "Couldn't load your orders."); setOrders([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function download(url: string) {
    setError("");
    const r = await callApi<{ url: string }>(url);
    if (r.ok && r.data?.url) window.location.href = r.data.url; else setError(r.error || "Download failed.");
  }

  async function upload(orderId: string, file: File) {
    setUploading(orderId); setError(""); setNote("");
    const form = new FormData(); form.set("file", file); form.set("orderId", orderId);
    const r = await callApi<{ filename: string }>("/api/uploads", { method: "POST", body: form });
    setUploading("");
    if (r.ok) { setNote(`Extracted ${r.data?.filename ?? "your file"} from the upload.`); load(); }
    else setError(r.error === "INVALID_OR_UNSUPPORTED_BOT_XML" ? "That file doesn't look like a bot XML." : r.error || "Upload failed.");
  }

  return (
    <main className="container page">
      <h1>My downloads</h1>
      <p className="lede" style={{ marginBottom: 20 }}>{signedIn ? "All orders on your account." : "Orders placed in this browser."}</p>
      {!signedIn && <div className="alert info">Sign in to open your downloads from any device. <Link href="/login"><b>Sign in</b></Link></div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {note && <div className="alert ok">{note}</div>}

      {orders === null && <p className="row muted"><span className="spinner" /> Loading…</p>}
      {orders?.length === 0 && <div className="card empty"><b>No orders yet</b><p style={{ margin: "6px 0 16px" }}>Your extracted bots will show up here.</p><Link href="/" className="btn btn-dark btn-sm">Extract a bot</Link></div>}

      <div style={{ display: "grid", gap: 14 }}>
        {orders?.map((o) => {
          const [label, tone] = STATUS[o.status] ?? ["Paid", "ok"];
          const hasFailed = o.jobs.some((j) => j.status === "FAILED");
          return (
            <section className="card" key={o.id} style={{ padding: 20 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div><b>{o.bulk_job_id ? `Bulk · ${o.quantity} bots` : "Single extraction"}</b><div className="muted" style={{ fontSize: 13 }}>{new Date(o.created_at).toLocaleString()} · KES {o.amount_kes.toLocaleString()}</div></div>
                <span className={`badge ${tone}`}>{label}</span>
              </div>
              <div style={{ marginTop: 10 }}>
                {o.jobs.map((j) => (
                  <div className="job" key={j.id}>
                    <div className="meta"><b>{j.bot_name || j.source_url || "Uploaded file"}</b><span>{j.status === "COMPLETED" ? j.filename : j.status === "FAILED" ? "Extraction failed" : "In progress…"}</span></div>
                    {j.status === "COMPLETED" ? <button className="btn btn-dark btn-sm" onClick={() => download(`/api/extractions/${j.id}/download`)}>Download</button> : j.status === "FAILED" ? <span className="badge err">Failed</span> : <span className="badge info">In progress</span>}
                  </div>
                ))}
              </div>
              {o.bulk_job_id && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => download(`/api/bulk/${o.bulk_job_id}/download`)}>Download bulk ZIP</button>}
              {o.status === "PAID" && hasFailed && (
                <label className="btn btn-ghost btn-sm" style={{ marginTop: 8, cursor: "pointer" }}>
                  {uploading === o.id ? "Uploading…" : "Upload the bot file instead"}
                  <input type="file" accept=".xml,.json,.zip,.txt,.dbot" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(o.id, f); e.target.value = ""; }} />
                </label>
              )}
              {o.status === "PAYMENT_PENDING" && <Link className="help" href={`/payment/return?order=${o.id}`}>Check payment status →</Link>}
            </section>
          );
        })}
      </div>
    </main>
  );
}
