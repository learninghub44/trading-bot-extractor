"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client";
import { normalizeKenyanPhone } from "@/lib/phone";

const TIERS = [
  { code: "bulk10", n: 10, price: 900 },
  { code: "bulk25", n: 25, price: 2000 },
  { code: "bulk50", n: 50, price: 3750 },
  { code: "bulk100", n: 100, price: 7000 },
];
const isUrl = (u: string) => /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(u);

export default function Bulk() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [code, setCode] = useState("bulk10");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const { urls, bad } = useMemo(() => {
    const all = [...new Set(text.split(/\r?\n|,|\s+/).map((x) => x.trim()).filter(Boolean))];
    return { urls: all.filter(isUrl), bad: all.filter((u) => !isUrl(u)) };
  }, [text]);
  const tier = TIERS.find((t) => t.code === code)!;
  const phoneNorm = normalizeKenyanPhone(phone);
  const tooMany = urls.length > tier.n;
  const valid = urls.length > 0 && !tooMany && !!phoneNorm;
  const suggested = TIERS.find((t) => t.n >= urls.length);

  async function start() {
    setTouched(true); setError("");
    if (!valid) return;
    setBusy(true);
    const created = await postJson<{ id: string }>("/api/bulk", { packageCode: code, urls });
    if (!created.ok || !created.data?.id) { setError(created.error || "Could not create the bulk job."); setBusy(false); return; }
    const pay = await postJson<{ orderId: string }>("/api/payments/create", { packageCode: code, phone: phoneNorm, bulkJobId: created.data.id });
    if (pay.ok && pay.data?.orderId) { router.push(`/payment/return?order=${pay.data.orderId}`); return; }
    setError(pay.error || "Payment could not be started."); setBusy(false);
  }

  return (
    <main className="container page">
      <div className="narrow" style={{ maxWidth: 680 }}>
        <span className="eyebrow">Bulk</span>
        <h1 style={{ marginTop: 14 }}>Extract many bots at once</h1>
        <p className="lede" style={{ marginBottom: 22 }}>Paste your links, pay once, and download everything as a single ZIP with a report of what worked.</p>
        <section className="card">
          {error && <div className="alert error" role="alert">{error}</div>}
          <div className="field">
            <label className="label" htmlFor="urls">Bot links <small>(one per line)</small></label>
            <textarea id="urls" className="textarea" rows={8} placeholder={"https://example.com/bot-one\nhttps://example.com/bot-two"} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={touched && (urls.length === 0 || tooMany)} />
            <p className={`count ${tooMany ? "err" : ""}`} style={tooMany ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
              {urls.length} valid link{urls.length === 1 ? "" : "s"}{bad.length ? ` · ${bad.length} ignored (not a link)` : ""}
            </p>
            {tooMany && <p className="help err">Too many links for this package{suggested ? ` — choose ${suggested.n} or more.` : " — the maximum is 100."}</p>}
          </div>

          <p className="label">Package</p>
          <div className="tiers" role="radiogroup">
            {TIERS.map((t) => (
              <label key={t.code} className={`tier ${code === t.code ? "sel" : ""}`}>
                <span className="l"><input type="radio" name="tier" checked={code === t.code} onChange={() => setCode(t.code)} /><span><b>{t.n} extractions</b><small>KES {(t.price / t.n).toFixed(0)} each</small></span></span>
                <b>KES {t.price.toLocaleString()}</b>
              </label>
            ))}
          </div>

          <div className="field">
            <label className="label" htmlFor="bphone">M-Pesa number</label>
            <div className="phone"><span className="prefix">+254</span>
              <input id="bphone" className="input" type="tel" inputMode="tel" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={touched && !phoneNorm} />
            </div>
            {touched && !phoneNorm && <p className="help err">Enter a Safaricom number like 0712 345 678.</p>}
          </div>

          <button className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? <><span className="spinner" /> Starting…</> : `Pay KES ${tier.price.toLocaleString()} & start`}
          </button>
        </section>
      </div>
    </main>
  );
}
