import CheckoutForm from "@/components/CheckoutForm";

const FAQ = [
  ["What links work?", "Public links to a bot file or a page that contains one: direct .xml files, JSON or ZIP files, Google Drive, Dropbox, GitHub and Pastebin share links, and pages that embed the bot. We never bypass logins, paywalls or CAPTCHAs."],
  ["What if my bot can't be found?", "We retry automatically, including a slower pass for pages that load content with JavaScript. If it still fails, you can upload the bot file from your downloads page and your payment still covers it."],
  ["How do I get my file?", "Right after payment this page shows a download button. You can always come back to My downloads on the same device, or sign in to access it anywhere. Download links are private and expire after 15 minutes — just request a fresh one."],
  ["Is my payment safe?", "Payments go through PayHero M-Pesa. We never see your PIN, and the order is only marked paid after a verified confirmation."],
];

export default function Home() {
  return (
    <main>
      <div className="container">
        <section className="hero">
          <span className="eyebrow">● M-Pesa · Instant · Automatic retries</span>
          <h1>Get your trading bot as a ready-to-use XML file.</h1>
          <p className="lede">Paste a public bot link, pay with M-Pesa, and download the validated XML in minutes. No sign-up needed.</p>
        </section>

        <div className="layout">
          <CheckoutForm />
          <aside className="card">
            <h2>How it works</h2>
            <p className="sub">Three steps, usually under two minutes.</p>
            <ol className="steps">
              <li><div><b>Paste the bot link</b><span>Any public link to the bot or the page it lives on.</span></div></li>
              <li><div><b>Approve the M-Pesa prompt</b><span>Pay on your phone. This page tracks it live.</span></div></li>
              <li><div><b>Download your XML</b><span>We find it, validate it and hand it over as an untouched file.</span></div></li>
            </ol>
          </aside>
        </div>

        <section className="section">
          <h2>Built to actually work</h2>
          <p className="sub">Most failures come from messy sources, so the engine tries several approaches before giving up.</p>
          <div className="grid3">
            <div className="tile"><h3>Finds bots in messy places</h3><p>Raw files, ZIPs, JSON APIs, escaped or encoded text, and download links buried a couple of pages deep.</p></div>
            <div className="tile"><h3>Retries on its own</h3><p>Timeouts and busy servers are retried automatically, so a paid job isn&apos;t lost to a bad moment.</p></div>
            <div className="tile"><h3>Private, validated delivery</h3><p>Only well-formed bot XML is accepted. Your file is stored privately and shared via an expiring link.</p></div>
          </div>
        </section>

        <section className="section faq">
          <h2 style={{ marginBottom: 16 }}>Questions</h2>
          {FAQ.map(([q, a]) => (<details key={q}><summary>{q}</summary><p>{a}</p></details>))}
        </section>
      </div>
    </main>
  );
}
