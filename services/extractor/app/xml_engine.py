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
    return etree.fromstring(raw, parser)

def validate_bot_xml(raw: bytes) -> str:
    root = parse_xml(raw)
    if not isinstance(root.tag, str):
        raise ValueError("INVALID_XML_ROOT")
    xml = etree.tostring(root, encoding="unicode", xml_declaration=True)
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
