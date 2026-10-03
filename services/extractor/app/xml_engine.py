from __future__ import annotations

from lxml import etree

from .models import CanonicalBot

def parse_xml(raw: bytes) -> etree._Element:
    parser = etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        huge_tree=False,
        remove_comments=False,
    )
    root = etree.fromstring(raw, parser)
    # Bot XML never needs a DTD or entities; reject them outright (XXE hardening).
    if root.getroottree().docinfo.doctype or any(
        node.tag is etree.Entity for node in root.iter()
    ):
        raise etree.XMLSyntaxError("DOCTYPE_OR_ENTITY_FORBIDDEN", 0, 0, 0)
    return root

def validate_bot_xml(raw: bytes) -> str:
    root = parse_xml(raw)
    if not isinstance(root.tag, str):
        raise ValueError("INVALID_XML_ROOT")
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + etree.tostring(root, encoding="unicode")
    if len(xml.encode("utf-8")) > 10 * 1024 * 1024:
        raise ValueError("XML_TOO_LARGE")
    return xml

def canonical_from_xml(raw: bytes) -> CanonicalBot:
    root = parse_xml(raw)
    name = root.get("name") or "trading-bot"
    blocks = []
    for node in root.iter():
        if node is root:
            continue
        blocks.append({
            "tag": node.tag,
            "attributes": dict(node.attrib),
            "text": node.text,
        })
    bot = CanonicalBot(name=name)
    bot.metadata["root_tag"] = root.tag
    bot.metadata["source_blocks"] = blocks
    return bot
