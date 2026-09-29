from app.strategies import direct_xml, embedded_xml

def test_direct_xml():
    assert direct_xml(b"<?xml version='1.0'?><xml/>") is not None

def test_embedded_xml():
    assert embedded_xml(b"<html><script>var x = '<xml><block/></xml>'</script></html>") is not None
