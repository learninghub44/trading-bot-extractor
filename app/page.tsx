"use client";
import Link from "next/link";
import {useEffect,useState} from "react";

export default function Home(){
 const [products,setProducts]=useState<{code:string;name:string;priceKes:number}[]>([]); const [url,setUrl]=useState(""); const [phone,setPhone]=useState(""); const [email,setEmail]=useState(""); const [product,setProduct]=useState("single"); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
 useEffect(()=>{fetch("/api/products").then(r=>r.json()).then(d=>setProducts(d.products||[]))},[]);
 async function checkout(){
  setBusy(true);setMessage("");
  try{const r=await fetch("/api/payments/create",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({packageCode:product,phone,email:email||undefined,sourceUrl:url||undefined})});const d=await r.json();if(!r.ok)throw new Error(d.error);setMessage("Payment request started. Complete the M-Pesa prompt. Your extraction will begin automatically after payment.");}
  catch(e){setMessage(e instanceof Error?e.message:"Unable to start payment.");}finally{setBusy(false)}
 }
 return <main className="shell"><nav><strong>Trading Bot Extractor</strong><div><Link href="/dashboard">Dashboard</Link><Link href="/login">Sign in</Link></div></nav><section className="hero"><p className="eyebrow">TRADING BOT EXTRACTOR</p><h1>Turn supported bot sources into downloadable XML.</h1><p className="lede">A production extraction engine that tries multiple legitimate strategies and validates the final XML before delivery.</p><div className="grid"><section className="panel"><h2>Extract a bot</h2><input type="url" placeholder="https://example.com/bot" value={url} onChange={e=>setUrl(e.target.value)}/><input placeholder="M-Pesa phone e.g. +254712345678" value={phone} onChange={e=>setPhone(e.target.value)}/><input type="email" placeholder="Email (optional)" value={email} onChange={e=>setEmail(e.target.value)}/><select value={product} onChange={e=>setProduct(e.target.value)}>{products.map(p=><option key={p.code} value={p.code}>{p.name} — KES {p.priceKes}</option>)}</select><button disabled={busy||!url||!phone} onClick={checkout}>{busy?"Starting…":"Pay & extract"}</button>{message&&<p className="notice">{message}</p>}</section><section className="panel"><h2>Pipeline</h2><ol><li>Validate and protect the source request.</li><li>Confirm payment from the server-side callback.</li><li>Run direct, linked, embedded and browser strategies.</li><li>Normalize and validate the resulting XML.</li><li>Store it privately in object storage.</li><li>Issue a short-lived secure download URL.</li></ol></section></div></section></main>
}
