"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main className="container page"><div className="narrow card" style={{ textAlign: "center" }}><h1 style={{ fontSize: 28 }}>Something went wrong</h1><p className="muted" style={{ margin: "10px 0 18px" }}>Please try again. If it keeps happening, come back in a few minutes.</p><button className="btn btn-dark btn-sm" onClick={reset}>Try again</button></div></main>;
}
