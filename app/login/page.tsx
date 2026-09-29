"use client";
import {FormEvent,useState} from "react";
import {createClient} from "@/lib/supabase/client";
export default function Login(){
 const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [signup,setSignup]=useState(false); const [message,setMessage]=useState("");
 async function submit(e:FormEvent){e.preventDefault();setMessage("");const s=createClient();const r=signup?await s.auth.signUp({email,password}):await s.auth.signInWithPassword({email,password});if(r.error)setMessage(r.error.message);else window.location.href="/dashboard";}
 return <main className="auth"><form onSubmit={submit} className="panel"><p className="eyebrow">TRADING BOT EXTRACTOR</p><h1>{signup?"Create account":"Sign in"}</h1><input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/><button>{signup?"Create account":"Sign in"}</button>{message&&<p>{message}</p>}<button type="button" className="link" onClick={()=>setSignup(!signup)}>{signup?"Already have an account? Sign in":"Create an account"}</button></form></main>
}
