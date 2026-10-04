"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson, callApi } from "@/lib/client";
import { normalizeKenyanPhone } from "@/lib/phone";

type Product = { code: string; name: string; quantity: number; priceKes: number };

export default function CheckoutForm() {
  const router = useRouter();
  const [price, setPrice] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    callApi<{ products: Product[] }>("/api/products").then((r) => {
      const single = r.data?.products?.find((p) => p.code === "single");
      if (single) setPrice(single.priceKes);
    });
  }, []);

  const urlOk = /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url.trim());
  const phoneNorm = normalizeKenyanPhone(phone);
  const emailOk = !email || /^\S+@\S+\.\S+$/.test(email);
  const valid = urlOk && !!phoneNorm && emailOk;
  const blur = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ url: true, phone: true, email: true });
    setError("");
    if (!valid) return;
    setBusy(true);
    const r = await postJson<{ orderId: string }>("/api/payments/create", {
      packageCode: "single", phone: phoneNorm, sourceUrl: url.trim(), ...(email ? { email } : {}),
    });
    if (r.ok && r.data?.orderId) { router.push(`/payment/return?order=${r.data.orderId}`); return; }
    setError(r.error || "Something went wrong. Please try again.");
    setBusy(false);
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>Extract a bot</h2>
      <p className="sub">Paste the link, pay with M-Pesa, download your XML.</p>

      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="field">
        <label className="label" htmlFor="url">Bot link</label>
        <input id="url" className="input" type="url" inputMode="url" autoComplete="off" placeholder="https://example.com/my-bot"
          value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => blur("url")} aria-invalid={touched.url && !urlOk} />
        {touched.url && !urlOk ? <p className="help err">Enter a full link starting with https://</p> : <p className="help">Works with public links, Google Drive, Dropbox, GitHub and direct .xml files.</p>}
      </div>

      <div className="field">
        <label className="label" htmlFor="phone">M-Pesa number</label>
        <div className="phone">
          <span className="prefix">+254</span>
          <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="712 345 678"
            value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => blur("phone")} aria-invalid={touched.phone && !phoneNorm} />
        </div>
        {touched.phone && !phoneNorm ? <p className="help err">Enter a Safaricom number like 0712 345 678.</p> : <p className="help">You&apos;ll get an M-Pesa prompt on this number.</p>}
      </div>

      <div className="field">
        <label className="label" htmlFor="email">Email <small>(optional, for your receipt)</small></label>
        <input id="email" className="input" type="email" autoComplete="email" placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => blur("email")} aria-invalid={touched.email && !emailOk} />
        {touched.email && !emailOk && <p className="help err">That email doesn&apos;t look right.</p>}
      </div>

      <div className="price"><span>Single extraction</span><strong>{price === null ? "…" : `KES ${price}`}</strong></div>

      <button className="btn btn-primary" disabled={busy}>
        {busy ? <><span className="spinner" /> Sending M-Pesa prompt…</> : <>Pay{price ? ` KES ${price}` : ""} &amp; extract</>}
      </button>
      <p className="help" style={{ textAlign: "center", marginTop: 12 }}>Extraction starts the moment payment is confirmed. Need many? <a href="/bulk"><b>Bulk pricing →</b></a></p>
    </form>
  );
}
