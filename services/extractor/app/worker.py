from __future__ import annotations

import hashlib
import os
import socket
import time
import io
import csv
import zipfile
from uuid import uuid4

import boto3
import httpx

SUPABASE_URL=os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
EXTRACTOR_URL=os.getenv("EXTRACTOR_SELF_URL","http://127.0.0.1:8000")
R2_BUCKET=os.environ["R2_BUCKET"]
WORKER_ID=os.getenv("WORKER_ID",f"worker-{socket.gethostname()}-{uuid4().hex[:8]}")
POLL_SECONDS=float(os.getenv("WORKER_POLL_SECONDS","2"))

s3=boto3.client("s3",endpoint_url=os.environ["R2_ENDPOINT"],aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],region_name="auto")

def headers(): return {"apikey":SUPABASE_KEY,"Authorization":f"Bearer {SUPABASE_KEY}","Content-Type":"application/json"}

def rpc(name,payload):
    r=httpx.post(f"{SUPABASE_URL}/rest/v1/rpc/{name}",headers=headers(),json=payload,timeout=20)
    r.raise_for_status(); return r.json()

def table_update(table, values, filters):
    params="&".join(f"{k}=eq.{v}" for k,v in filters.items())
    r=httpx.patch(f"{SUPABASE_URL}/rest/v1/{table}?{params}",headers=headers(),json=values,timeout=20)
    r.raise_for_status()

def table_get(path):
    r=httpx.get(f"{SUPABASE_URL}/rest/v1/{path}",headers=headers(),timeout=20)
    r.raise_for_status(); return r.json()

def table_insert(table, values):
    r=httpx.post(f"{SUPABASE_URL}/rest/v1/{table}",headers={**headers(),"Prefer":"return=minimal"},json=values,timeout=20)
    r.raise_for_status()

def build_bulk_if_ready(job_id):
    links=table_get(f"bulk_items?extraction_job_id=eq.{job_id}&select=bulk_job_id")
    if not links: return
    bulk_id=links[0]["bulk_job_id"]
    items=table_get(f"bulk_items?bulk_job_id=eq.{bulk_id}&select=id,position,source_url,status,extraction_job_id,error_code,error_message&order=position.asc")
    if not items or any(i["status"] in {"WAITING_FOR_PAYMENT","PAID","QUEUED","EXTRACTING"} for i in items): return
    zip_buffer=io.BytesIO()
    manifest=io.StringIO()
    writer=csv.writer(manifest); writer.writerow(["position","source_url","status","filename","error"])
    with zipfile.ZipFile(zip_buffer,"w",zipfile.ZIP_DEFLATED) as archive:
        for item in items:
            filename=f"{item['position']:03d}-trading-bot.xml"
            if item["status"]=="COMPLETED" and item.get("extraction_job_id"):
                jobs=table_get(f"extraction_jobs?id=eq.{item['extraction_job_id']}&select=result_key,filename")
                if jobs and jobs[0].get("result_key"):
                    obj=s3.get_object(Bucket=R2_BUCKET,Key=jobs[0]["result_key"])
                    archive.writestr(filename,obj["Body"].read())
                    writer.writerow([item["position"],item["source_url"],"COMPLETED",jobs[0].get("filename") or filename,""])
                else:
                    writer.writerow([item["position"],item["source_url"],"FAILED","", "RESULT_NOT_FOUND"])
            else:
                writer.writerow([item["position"],item["source_url"],"FAILED","",item.get("error_message") or item.get("error_code") or "EXTRACTION_FAILED"])
        archive.writestr("manifest.csv",manifest.getvalue())
    key=f"bulk/{bulk_id}/results.zip"
    s3.put_object(Bucket=R2_BUCKET,Key=key,Body=zip_buffer.getvalue(),ContentType="application/zip",CacheControl="private, max-age=0, no-store")
    table_update("bulk_jobs",{"status":"COMPLETED","zip_key":key,"completed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())},{"id":bulk_id})

def process(job):
    job_id=job["id"]
    source=job.get("source_url")
    started=time.time()
    try:
        with httpx.Client(timeout=125) as client:
            response=client.post(f"{EXTRACTOR_URL}/extract",headers={"x-extractor-secret":os.getenv("EXTRACTOR_SHARED_SECRET","")},json={"url":source,"use_browser":True})
            response.raise_for_status()
            data=response.json()
        if data.get("status")!="COMPLETED" or not data.get("xml"):
            raise RuntimeError(data.get("error") or "BOT_DATA_NOT_FOUND")
        xml=data["xml"].encode()
        digest=hashlib.sha256(xml).hexdigest()
        key=f"results/{job_id}/{digest}.xml"
        s3.put_object(Bucket=R2_BUCKET,Key=key,Body=xml,ContentType="application/xml",CacheControl="private, max-age=0, no-store")
        rpc("complete_extraction_job",{"p_id":job_id,"p_worker_id":WORKER_ID,"p_status":"COMPLETED","p_result_key":key,"p_filename":data.get("filename") or "trading-bot.xml","p_bot_name":data.get("bot_name") or "trading-bot","p_sha256":digest,"p_size":len(xml)})
table_insert("extraction_attempts",{"job_id":job_id,"adapter":data.get("strategy") or "engine","strategy":data.get("strategy") or "engine","status":"SUCCESS","duration_ms":int((time.time()-started)*1000)})
        table_update("bulk_items",{"status":"COMPLETED"},{"extraction_job_id":job_id})
        build_bulk_if_ready(job_id)
    except Exception as exc:
        rpc("complete_extraction_job",{"p_id":job_id,"p_worker_id":WORKER_ID,"p_status":"FAILED","p_error_code":"EXTRACTION_FAILED","p_error_message":str(exc)[:1000]})
table_insert("extraction_attempts",{"job_id":job_id,"adapter":"engine","strategy":"orchestrator","status":"FAILED","duration_ms":int((time.time()-started)*1000),"error_code":"EXTRACTION_FAILED","metadata":{"message":str(exc)[:500]}})
        table_update("bulk_items",{"status":"FAILED","error_code":"EXTRACTION_FAILED","error_message":str(exc)[:500]},{"extraction_job_id":job_id})
        build_bulk_if_ready(job_id)

def run():
    while True:
        try:
            jobs=rpc("claim_extraction_jobs",{"p_worker_id":WORKER_ID,"p_limit":5})
            for job in jobs: process(job)
        except Exception:
            time.sleep(POLL_SECONDS)
        time.sleep(POLL_SECONDS)

if __name__=="__main__": run()
