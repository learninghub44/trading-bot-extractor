import {NextResponse} from "next/server";
import {adminClient} from "@/lib/server";
import {cookies} from "next/headers";
import {createHash} from "crypto";
import {createClient} from "@/lib/supabase/server";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params; const db=adminClient();
 const {data:job}=await db.from("extraction_jobs").select("id,order_id,status,source_url,bot_name,filename,error_code,error_message,created_at,started_at,completed_at").eq("id",id).maybeSingle();
 if(!job)return NextResponse.json({error:"Job not found."},{status:404});
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 const token=(await cookies()).get("tbe_access")?.value;
 const hash=token?createHash("sha256").update(token).digest("hex"):null;
 const {data:order}=job.order_id?await db.from("orders").select("user_id,customer_token_hash").eq("id",job.order_id).maybeSingle():{data:null};
 if(!order || (user?.id && order.user_id===user.id) || (hash && hash===order.customer_token_hash)) return NextResponse.json(job);
 return NextResponse.json({error:"FORBIDDEN"},{status:403});
}
