import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server";
import { putPrivateObject } from "@/lib/storage";
import { randomUUID, createHash } from "crypto";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const orderId = String(form.get("orderId") || "");
  if (!(file instanceof File) || !orderId) return NextResponse.json({error:"File and paid order are required."},{status:400});
  const max=Number(process.env.MAX_UPLOAD_BYTES||10485760);
  if(file.size>max) return NextResponse.json({error:"FILE_TOO_LARGE"},{status:413});

  const db=adminClient();
  const {data:order}=await db.from("orders").select("id,status,amount_kes").eq("id",orderId).maybeSingle();
  if(!order || order.status!=="PAID") return NextResponse.json({error:"ORDER_NOT_PAID"},{status:402});

  const jobId=randomUUID();
  const extractor=process.env.EXTRACTOR_URL;
  if(!extractor) return NextResponse.json({error:"EXTRACTOR_NOT_CONFIGURED"},{status:503});

  const formOut=new FormData();
  formOut.append("file",new Blob([await file.arrayBuffer()],{type:file.type||"application/xml"}),file.name);
  const response=await fetch(`${extractor.replace(/\/$/,"")}/extract-upload`,{
    method:"POST",
    headers:process.env.EXTRACTOR_SHARED_SECRET?{"x-extractor-secret":process.env.EXTRACTOR_SHARED_SECRET}:undefined,
    body:formOut,
    signal:AbortSignal.timeout(Number(process.env.EXTRACTOR_TIMEOUT_MS||120000))
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok || data?.status!=="COMPLETED") {
    await db.from("extraction_jobs").insert({id:jobId,order_id:orderId,status:"FAILED",payment_status:"PAID",error_code:data?.error||"UPLOAD_EXTRACTION_FAILED"});
    return NextResponse.json({error:data?.error||"Extraction failed."},{status:422});
  }

  const xml=Buffer.from(data.xml,"utf8");
  const digest=createHash("sha256").update(xml).digest("hex");
  const key=`results/${jobId}/${digest}.xml`;
  await putPrivateObject(key,xml,"application/xml");
  await db.from("extraction_jobs").insert({
    id:jobId,order_id:orderId,status:"COMPLETED",payment_status:"PAID",
    source_type:"upload",bot_name:data.bot_name,filename:data.filename||"trading-bot.xml",
    result_key:key,result_sha256:digest,result_size:xml.length,validation_status:"VALID",
    adapter:data.strategy,started_at:new Date().toISOString(),completed_at:new Date().toISOString()
  });
  return NextResponse.json({id:jobId,status:"COMPLETED",filename:data.filename||"trading-bot.xml"});
}
