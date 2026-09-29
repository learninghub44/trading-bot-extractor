import {NextResponse} from "next/server";
import {adminClient} from "@/lib/server";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const db=adminClient();const {data,error}=await db.from("bulk_jobs").select("id,status,quantity,amount_kes,zip_key,created_at,completed_at").eq("id",id).maybeSingle();if(error)return NextResponse.json({error:"Unable to load bulk job."},{status:500});if(!data)return NextResponse.json({error:"Bulk job not found."},{status:404});return NextResponse.json(data)}
