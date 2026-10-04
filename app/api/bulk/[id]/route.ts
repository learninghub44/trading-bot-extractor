import {NextResponse} from "next/server";
import { withApi } from "@/lib/api";
import {adminClient} from "@/lib/server";
import {runtime} from "@/lib/env";
async function handleGET(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const db=adminClient(runtime().env);const {data,error}=await db.from("bulk_jobs").select("id,status,quantity,amount_kes,created_at,completed_at").eq("id",id).maybeSingle();if(error)return NextResponse.json({error:"Unable to load bulk job."},{status:500});if(!data)return NextResponse.json({error:"Bulk job not found."},{status:404});return NextResponse.json(data)}

export const GET = withApi(handleGET);
