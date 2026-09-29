import {NextResponse} from "next/server";
import {adminClient} from "@/lib/server";
import {signedDownload} from "@/lib/storage";
import {cookies} from "next/headers";
import {createHash} from "crypto";
import {createClient} from "@/lib/supabase/server";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params; const db=adminClient();
 const {data:job}=await db.from("extraction_jobs").select("id,order_id,status,result_key,filename").eq("id",id).maybeSingle();
 if(!job)return NextResponse.json({error:"Job not found."},{status:404});
 if(job.status!=="COMPLETED"||!job.result_key)return NextResponse.json({error:"Download is not available."},{status:409});
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 const token=(await cookies()).get("tbe_access")?.value;
 const hash=token?createHash("sha256").update(token).digest("hex"):null;
 const {data:order}=job.order_id?await db.from("orders").select("user_id,customer_token_hash").eq("id",job.order_id).maybeSingle():{data:null};
 if(!order || (user?.id && order.user_id===user.id) || (hash && hash===order.customer_token_hash)) return NextResponse.json({url:await signedDownload(job.result_key,job.filename||"trading-bot.xml"),expiresIn:Number(process.env.DOWNLOAD_TTL_SECONDS||900)});
 return NextResponse.json({error:"FORBIDDEN"},{status:403});
}
