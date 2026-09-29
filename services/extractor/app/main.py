from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlparse
from uuid import uuid4

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl
from lxml import etree

app = FastAPI(title="Trading Bot Extractor", version="0.1.0")

MAX_BYTES = 10 * 1024 * 1024
TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class ExtractRequest(BaseModel):
    url: HttpUrl


class ExtractResponse(BaseModel):
    id: str
    status: str
    source: str | None = None
    filename: str | None = None
    xml: str | None = None
    error: str | None = None


def assert_public_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only HTTP(S) URLs are supported.")

    host = parsed.hostname
    try:
        addresses = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError("Host could not be resolved.") from exc

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Private or internal destinations are not allowed.")


async def fetch(url: str) -> tuple[str, bytes, str]:
    current = url
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, headers={"user-agent": "TradingBotExtractor/0.1"}) as client:
        for _ in range(5):
            assert_public_host(current)
            response = await client.get(current)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise ValueError("Redirect has no destination.")
                current = urljoin(current, location)
                continue

            if response.status_code >= 400:
                raise ValueError(f"Source returned HTTP {response.status_code}.")

            content = response.content
            if len(content) > MAX_BYTES:
                raise ValueError("Source exceeds the maximum allowed size.")
            return current, content, response.headers.get("content-type", "")
    raise ValueError("Too many redirects.")


def validate_xml(raw: bytes) -> str:
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    root = etree.fromstring(raw, parser=parser)
    if root.tag is None:
        raise ValueError("XML has no root element.")
    return etree.tostring(root, encoding="unicode", xml_declaration=True)


def extract_xml(url: str, content: bytes, content_type: str) -> tuple[str, str] | None:
    stripped = content.lstrip()
    if "xml" in content_type.lower() or stripped.startswith(b"<?xml") or stripped.startswith(b"<"):
        try:
            xml = validate_xml(content)
            root = etree.fromstring(xml.encode())
            if root.tag.lower().endswith("xml") or "block" in xml.lower() or "bot" in xml.lower():
                return xml, "direct"
        except (etree.XMLSyntaxError, ValueError):
            pass

    if "html" in content_type.lower() or b"<html" in content[:2048].lower():
        soup = BeautifulSoup(content, "html.parser")
        candidates = []
        for tag in soup.find_all(["a", "link"]):
            href = tag.get("href")
            if href and (href.lower().endswith(".xml") or "download" in href.lower() or "bot" in href.lower()):
                candidates.append(urljoin(url, href))
        for candidate in candidates[:10]:
            try:
                # Candidate URLs are fetched through the same SSRF-safe path.
                # This MVP returns only discovered links; recursive extraction is added per adapter.
                return "", f"discovered:{candidate}"
            except Exception:
                continue

    return None


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractResponse)
async def extract(request: ExtractRequest):
    job_id = str(uuid4())
    try:
        final_url, content, content_type = await fetch(str(request.url))
        result = extract_xml(final_url, content, content_type)
        if not result:
            return ExtractResponse(id=job_id, status="FAILED", error="BOT_DATA_NOT_FOUND")

        xml, source = result
        if not xml:
            return ExtractResponse(id=job_id, status="DISCOVERED", source=source)

        return ExtractResponse(
            id=job_id,
            status="COMPLETED",
            source=source,
            filename="trading-bot.xml",
            xml=xml,
        )
    except ValueError as exc:
        return ExtractResponse(id=job_id, status="FAILED", error=str(exc))
    except httpx.HTTPError:
        return ExtractResponse(id=job_id, status="FAILED", error="SOURCE_REQUEST_FAILED")
