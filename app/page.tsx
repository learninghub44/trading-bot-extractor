"use client";

import { FormEvent, useState } from "react";

type Result = { id: string; status: string; message?: string };

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);

    try {
      const response = await fetch("/api/extractions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Extraction could not be started.");
      setResult(data);
    } catch (error) {
      setResult({ id: "", status: "FAILED", message: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">TRADING BOT EXTRACTOR</p>
        <h1>Extract your bot into an XML file.</h1>
        <p className="lede">Submit a supported public or authorized bot source. The extraction engine tries multiple legitimate strategies before reporting failure.</p>

        <form onSubmit={submit} className="extract-card">
          <label htmlFor="url">Bot URL</label>
          <div className="input-row">
            <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/bot" type="url" required />
            <button disabled={busy}>{busy ? "Starting…" : "Extract"}</button>
          </div>
          <p className="price">KES 100 per successful extraction</p>
        </form>

        {result && (
          <div className="result" role="status">
            <strong>{result.status}</strong>
            {result.message && <span>{result.message}</span>}
            {result.id && <small>Job: {result.id}</small>}
          </div>
        )}
      </section>
    </main>
  );
}
