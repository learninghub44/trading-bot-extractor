from __future__ import annotations

import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

XML_RE = re.compile(rb"<\?xml[\s\S]*?</[A-Za-z_][^>]*>|<xml[\s\S]*?</xml>", re.I)

def direct_xml(content: bytes) -> bytes | None:
    stripped = content.lstrip()
    if stripped.startswith(b"<?xml") or stripped.startswith(b"<xml"):
        return content
    return None

def html_xml_candidates(base_url: str, content: bytes) -> list[str]:
    soup = BeautifulSoup(content, "html.parser")
    found: list[str] = []
    for tag in soup.find_all(["a", "link", "iframe", "script"]):
        for attr in ("href", "src", "data-url", "data-download"):
            value = tag.get(attr)
            if not value:
                continue
            value_lower = value.lower()
            if ".xml" in value_lower or "download" in value_lower or "bot" in value_lower:
                found.append(urljoin(base_url, value))
    return list(dict.fromkeys(found))

def embedded_xml(content: bytes) -> bytes | None:
    match = XML_RE.search(content)
    return match.group(0) if match else None
