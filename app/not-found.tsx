import Link from "next/link";
export default function NotFound() {
  return <main className="container page"><div className="narrow card" style={{ textAlign: "center" }}><h1 style={{ fontSize: 28 }}>Page not found</h1><p className="muted" style={{ margin: "10px 0 18px" }}>That page doesn&apos;t exist.</p><Link href="/" className="btn btn-dark btn-sm">Back home</Link></div></main>;
}
