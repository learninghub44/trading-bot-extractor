from __future__ import annotations

import os
from uuid import uuid4

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, HttpUrl

from .extractor import extract, from_xml

app = FastAPI(title="Trading Bot Extractor Engine", version="1.0.0")

class ExtractRequest(BaseModel):
    url: HttpUrl
    use_browser: bool = True

class ExtractResponse(BaseModel):
    id: str
    status: str
    strategy: str | None = None
    filename: str | None = None
    bot_name: str | None = None
    sha256: str | None = None
    size: int | None = None
    xml: str | None = None
    error: str | None = None

def authorized(secret: str | None):
    expected=os.getenv("EXTRACTOR_SHARED_SECRET")
    if expected and secret != expected: raise HTTPException(status_code=401, detail="UNAUTHORIZED")

@app.get("/health")
async def health():
    return {"status":"ok","service":"extractor","version":"1.0.0"}

@app.post("/extract", response_model=ExtractResponse)
async def extract_route(request: ExtractRequest, x_extractor_secret: str | None = Header(default=None)):
    authorized(x_extractor_secret)
    job_id=str(uuid4())
    try:
        result=await extract(str(request.url), request.use_browser)
        return ExtractResponse(id=job_id,status="COMPLETED",strategy=result.strategy,filename=result.filename,bot_name=result.bot_name,sha256=result.sha256,size=len(result.xml),xml=result.xml.decode("utf-8"))
    except Exception as exc:
        return ExtractResponse(id=job_id,status="FAILED",error=str(exc))

@app.post("/extract-upload", response_model=ExtractResponse)
async def extract_upload(file: UploadFile = File(...), x_extractor_secret: str | None = Header(default=None)):
    authorized(x_extractor_secret)
    raw=await file.read()
    if len(raw)>10*1024*1024: raise HTTPException(status_code=413, detail="FILE_TOO_LARGE")
    result=from_xml(raw,"upload")
    if not result: return ExtractResponse(id=str(uuid4()),status="FAILED",error="INVALID_OR_UNSUPPORTED_BOT_XML")
    return ExtractResponse(id=str(uuid4()),status="COMPLETED",strategy=result.strategy,filename=file.filename or result.filename,bot_name=result.bot_name,sha256=result.sha256,size=len(result.xml),xml=result.xml.decode("utf-8"))
