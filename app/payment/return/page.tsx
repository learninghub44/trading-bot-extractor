"use client";
import {useEffect,useState} from "react";
export default function PaymentReturn({searchParams}:{searchParams:Promise<{order?:string}>}){
 const [order,setOrder]=useState(""); const [message,setMessage]=useState("Checking payment…");
 useEffect(()=>{searchParams.then(async p=>{setOrder(p.order||""); if(!p.order){setMessage("Missing order.");return} setMessage("Payment status is confirmed by the server webhook. If payment succeeds, your job will appear shortly.")})},[searchParams]);
 return <main className="auth"><section className="panel"><p className="eyebrow">PAYMENT</p><h1>Payment submitted</h1><p>{message}</p>{order&&<p>Order: {order}</p>}<a href="/dashboard">Open dashboard</a></section></main>
}
