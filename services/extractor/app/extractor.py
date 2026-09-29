from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from lxml import etree

MAX_BYTES = 10 * 1024 * 1024
MAX_REDIRECTS = 5
MAX_CANDIDATES = 30
TIMEOUT = httpx.Timeout(20.0, connect=7.0)

@dataclass
class ExtractionResult:
    xml: bytes
    filename: str
    strategy: str
    bot_name: str
    sha256: str

def validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("INVALID_URL")
    host = parsed.hostname.lower().rstrip(".")
    if host in {"localhost", "metadata.google.internal"} or host.endswith(".local"):
        raise ValueError("PRIVATE_DESTINATION_BLOCKED")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError("HOST_RESOLUTION_FAILED") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise ValueError("PRIVATE_DESTINATION_BLOCKED")

async def fetch(url: str) -> tuple[str, bytes, str, str]:
    current = url
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, headers={"user-agent":"TradingBotExtractor/1.0"}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            validate_url(current)
            response = await client.get(current)
            if response.status_code in {301,302,303,307,308}:
                location = response.headers.get("location")
                if not location: raise ValueError("REDIRECT_WITHOUT_LOCATION")
                current = urljoin(current, location)
                continue
            if response.status_code >= 400: raise ValueError(f"SOURCE_HTTP_{response.status_code}")
            content = response.content
            if len(content) > MAX_BYTES: raise ValueError("SOURCE_TOO_LARGE")
            return current, content, response.headers.get("content-type",""), response.headers.get("content-disposition","")
    raise ValueError("TOO_MANY_REDIRECTS")

def parse_xml(raw: bytes) -> etree._Element:
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, recover=False)
    return etree.fromstring(raw, parser)

def validate_xml(raw: bytes) -> bytes:
    root = parse_xml(raw)
    if not isinstance(root.tag, str): raise ValueError("INVALID_XML_ROOT")
    output = etree.tostring(root, encoding="UTF-8", xml_declaration=True)
    if len(output) > MAX_BYTES: raise ValueError("XML_TOO_LARGE")
    return output

def looks_like_bot(root: etree._Element) -> bool:
    tags = " ".join(str(n.tag).lower() for n in root.iter() if isinstance(n.tag, str))
    attrs = " ".join(" ".join(n.attrib.values()).lower() for n in root.iter())
    return root.tag.lower() == "xml" or "block" in tags or "bot" in tags or "trade" in tags or "strategy" in tags or "block" in attrs or "trade" in attrs

def bot_name(root: etree._Element) -> str:
    for key in ("name","title","bot_name"):
        if root.get(key): return root.get(key)[:120]
    for node in root.iter():
        if isinstance(node.tag,str) and node.get("name"): return node.get("name")[:120]
    return "trading-bot"

def from_xml(raw: bytes, strategy: str) -> ExtractionResult | None:
    try:
        normalized = validate_xml(raw)
        root = parse_xml(normalized)
        if not looks_like_bot(root): return None
        return ExtractionResult(normalized, "trading-bot.xml", strategy, bot_name(root), hashlib.sha256(normalized).hexdigest())
    except (etree.XMLSyntaxError, ValueError):
        return None

def candidates(base: str, content: bytes) -> list[str]:
    soup = BeautifulSoup(content, "html.parser")
    found=[]
    for tag in soup.find_all(["a","link","iframe","script","form"]):
        for attr in ("href","src","data-url","data-download","action"):
            value=tag.get(attr)
            if not value or value.startswith(("javascript:","data:","mailto:")): continue
            low=value.lower()
            if any(x in low for x in (".xml","download","export","bot","strategy")):
                found.append(urljoin(base,value))
    for match in re.findall(rb'https?://[^"\'\s<>]+', content):
        try: found.append(match.decode())
        except UnicodeDecodeError: pass
    return list(dict.fromkeys(found))[:MAX_CANDIDATES]

def embedded_json_xml(content: bytes) -> list[bytes]:
    soup=BeautifulSoup(content,"html.parser")
    results=[]
    for script in soup.find_all("script"):
        text=script.string or script.get_text()
        if not text: continue
        for match in re.findall(r'(<\?xml[\s\S]*?</[^>]+>|<xml[\s\S]*?</xml>)',text,re.I):
            results.append(match.encode())
        if script.get("type") in {"application/json","application/ld+json"}:
            try:
                obj=json.loads(text)
                stack=[obj]
                while stack:
                    item=stack.pop()
                    if isinstance(item,str) and ("<xml" in item.lower() or "<?xml" in item.lower()): results.append(item.encode())
                    elif isinstance(item,dict): stack.extend(item.values())
                    elif isinstance(item,list): stack.extend(item)
            except json.JSONDecodeError: pass
    return results

async def extract(url: str, use_browser: bool = True) -> ExtractionResult:
    final_url, content, content_type, disposition = await fetch(url)
    direct=from_xml(content,"direct")
    if direct: return direct

    for embedded in embedded_json_xml(content):
        result=from_xml(embedded,"embedded")
        if result: return result

    for candidate in candidates(final_url, content):
        try:
            _, candidate_content, candidate_type, candidate_disposition = await fetch(candidate)
            result=from_xml(candidate_content,"linked-file")
            if result: return result
            for embedded in embedded_json_xml(candidate_content):
                result=from_xml(embedded,"linked-embedded")
                if result: return result
        except Exception:
            continue

    if use_browser:
        result=await browser_extract(url)
        if result: return result

    raise ValueError("BOT_DATA_NOT_FOUND")

async def browser_extract(url: str) -> ExtractionResult | None:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return None
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(service_workers="block")
        page=await context.new_page()
        async def route_handler(route):
            target=route.request.url
            try: validate_url(target); await route.continue_()
            except Exception: await route.abort()
        await page.route("**/*",route_handler)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=10000)
            html=await page.content()
            result=from_xml(html.encode(),"browser-page")
            if result: return result
            for embedded in embedded_json_xml(html.encode()):
                result=from_xml(embedded,"browser-embedded")
                if result: return result
            for candidate in candidates(page.url, html.encode()):
                try:
                    _, data, _, _=await fetch(candidate)
                    result=from_xml(data,"browser-linked")
                    if result: return result
                except Exception: continue
            return None
        finally:
            await browser.close()
