from lxml import etree
from app.xml_engine import validate_bot_xml

def test_valid_xml():
    result = validate_bot_xml(b'<?xml version="1.0"?><xml><block type="trade"/></xml>')
    assert "<block" in result

def test_external_entities_are_disabled():
    malicious = b'<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><xml>&xxe;</xml>'
    try:
        validate_bot_xml(malicious)
    except etree.XMLSyntaxError:
        pass
    else:
        raise AssertionError("XXE payload must not be accepted")
