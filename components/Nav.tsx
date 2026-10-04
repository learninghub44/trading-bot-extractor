import Link from "next/link";

export default function Nav() {
  return (
    <header className="topbar">
      <div className="container">
        <Link href="/" className="brand"><span className="brand-mark">⬇</span>Bot Extractor</Link>
        <nav className="nav" aria-label="Main">
          <Link href="/bulk">Bulk</Link>
          <Link href="/dashboard">My downloads</Link>
          <Link href="/login" className="cta">Sign in</Link>
        </nav>
      </div>
    </header>
  );
}
