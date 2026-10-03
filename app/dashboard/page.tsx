import {createClient} from "@/lib/supabase/server";
import Link from "next/link";
import {redirect} from "next/navigation";
export default async function Dashboard(){
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect("/login");
 return <main className="dashboard"><header><div><p className="eyebrow">ACCOUNT</p><h1>Dashboard</h1></div><Link href="/">New extraction</Link></header><section className="cards"><div className="panel"><strong>Extraction history</strong><p>Your completed and failed jobs will appear here.</p></div><div className="panel"><strong>Credits</strong><p>Buy extraction packages for single or bulk jobs.</p></div><div className="panel"><strong>Downloads</strong><p>Completed XML files use short-lived secure links.</p></div></section></main>
}
