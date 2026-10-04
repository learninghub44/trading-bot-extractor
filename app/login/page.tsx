"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(""); setInfo(""); setBusy(true);
    try {
      const s = createClient();
      const r = signup ? await s.auth.signUp({ email, password }) : await s.auth.signInWithPassword({ email, password });
      if (r.error) setError(r.error.message);
      else if (signup && !r.data.session) setInfo("Account created. Check your email to confirm it, then sign in.");
      else window.location.href = "/dashboard";
    } catch {
      setError("Sign-in isn't available right now. Please try again shortly.");
    }
    setBusy(false);
  }

  return (
    <main className="auth-wrap">
      <form onSubmit={submit} className="card">
        <h2>{signup ? "Create your account" : "Welcome back"}</h2>
        <p className="sub">{signup ? "Keep your downloads on every device." : "Sign in to see your downloads."}</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        {info && <div className="alert ok">{info}</div>}
        <div className="field"><label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          {signup && <p className="help">At least 8 characters.</p>}</div>
        <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : signup ? "Create account" : "Sign in"}</button>
        <p style={{ textAlign: "center", marginTop: 12 }}><button type="button" className="link-btn" onClick={() => { setSignup(!signup); setError(""); setInfo(""); }}>{signup ? "Already have an account? Sign in" : "New here? Create an account"}</button></p>
      </form>
    </main>
  );
}
