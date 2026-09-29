import {NextResponse} from "next/server";
import {adminClient} from "@/lib/server";
import {signedDownload} from "@/lib/storage";
import {cookies} from "next/headers";
import {createHash} from "crypto";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params; const db=adminClient();
 const {data:bulk}=await db.from("bulk_jobs").select("id,status,zip_key").eq("id",id).maybeSingle();
 if(!bulk)return NextResponse.json({error:"Bulk job not found."},{status:404});
 if(bulk.status!=="COMPLETED"||!bulk.zip_key)return NextResponse.json({error:"Bulk download is not ready."},{status:409});
 const token=(await cookies()).get("tbe_access")?.value;
 if(!token)return NextResponse.json({error:"FORBIDDEN"},{status:403});
 const hash=createHash("sha256").update(token).digest("hex");
 const {data:order}=await db.from("orders").select("customer_token_hash").eq("bulk_job_id",id).maybeSingle();
 if(!order||order.customer_token_hash!==hash)return NextResponse.json({error:"FORBIDDEN"},{status:403});
 return NextResponse.json({url:await signedDownload(bulk.zip_key,'trading-bot-extractions-'+id+'.zip'),expiresIn:Number(process.env.DOWNLOAD_TTL_SECONDS||900)});
}
