import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractFromUpload, extractFromUrl } from "./extract";
import { validateUrlShape } from "./ssrf";
import { toBotXml } from "./xml";

const BOT = `<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true"><variables><variable id="a">stake</variable></variables><block type="trade_definition" id="1" x="0" y="0"><field name="MARKET_LIST">synthetic_index</field></block></xml>`;
const env = { DNS_CHECK: "off" } as Record<string, unknown>;
const opts = () => ({ env, allowBrowser: false, deadline: Date.now() + 30_000 });

function mockWeb(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = input.toString();
    calls.push(url);
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  });
  return calls;
}
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });

afterEach(() => vi.unstubAllGlobals());

describe("ssrf", () => {
  it.each([
    "http://localhost/x", "http://127.0.0.1/", "http://0x7f.1/", "http://2130706433/", "http://10.0.0.5/",
    "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/",
    "http://metadata.google.internal/", "http://intranet/", "http://user:pw@example.com/", "http://example.com:22/",
    "ftp://example.com/", "file:///etc/passwd",
  ])("blocks %s", (url) => {
    expect(() => validateUrlShape(url)).toThrow();
  });
  it("allows public https", () => {
    expect(validateUrlShape("https://example.com/bot.xml").hostname).toBe("example.com");
  });
});

describe("toBotXml", () => {
  it("accepts a Blockly bot and keeps content", async () => {
    const r = await toBotXml(BOT);
    expect(r?.xml).toContain('type="trade_definition"');
    expect(r?.xml.startsWith("<?xml")).toBe(true);
  });
  it("rejects entities, DOCTYPE, non-bots and malformed XML", async () => {
    expect(await toBotXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><xml><block type="a"/>&a;</xml>')).toBeNull();
    expect(await toBotXml("<xml></xml>")).toBeNull();
    expect(await toBotXml("<rss><channel><title>t</title></channel></rss>")).toBeNull();
    expect(await toBotXml("<xml><block type='a'></xml>")).toBeNull();
  });
});

describe("extractFromUrl", () => {
  it("direct XML", async () => {
    mockWeb({ "https://a.com/bot.xml": () => new Response(BOT) });
    const r = await extractFromUrl("https://a.com/bot.xml", opts());
    expect(r.strategy).toBe("direct");
    expect(r.filename).toBe("bot.xml");
  });
  it("XML escaped inside a script JSON string", async () => {
    const escaped = JSON.stringify(BOT).replace(/</g, "\\u003c");
    mockWeb({ "https://a.com/p": () => html(`<script>window.__S__={"xml":${escaped}}</script>`) });
    expect((await extractFromUrl("https://a.com/p", opts())).xml).toContain("trade_definition");
  });
  it("entity-escaped XML in <pre>", async () => {
    const esc = BOT.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    mockWeb({ "https://a.com/p": () => html(`<pre>${esc}</pre>`) });
    expect((await extractFromUrl("https://a.com/p", opts())).xml).toContain("trade_definition");
  });
  it("base64 XML in JSON API", async () => {
    mockWeb({ "https://a.com/api": () => new Response(JSON.stringify({ data: { file: btoa(BOT) } }), { headers: { "content-type": "application/json" } }) });
    expect((await extractFromUrl("https://a.com/api", opts())).xml).toContain("trade_definition");
  });
  it("follows a download link two levels deep", async () => {
    mockWeb({
      "https://a.com/p": () => html(`<a href="/get">Get the bot</a>`),
      "https://a.com/get": () => html(`<a href="/files/my-bot.xml">download</a>`),
      "https://a.com/files/my-bot.xml": () => new Response(BOT),
    });
    const r = await extractFromUrl("https://a.com/p", opts());
    expect(r.strategy).toBe("linked");
  });
  it("extracts XML from a zip", async () => {
    const zip = zipSync({ "readme.txt": strToU8("hi"), "My Bot.xml": strToU8(BOT) });
    mockWeb({ "https://a.com/b.zip": () => new Response(zip) });
    const r = await extractFromUrl("https://a.com/b.zip", opts());
    expect(r.strategy).toContain("zip");
  });
  it("rewrites Google Drive and GitHub share links", async () => {
    const calls = mockWeb({
      "https://drive.usercontent.google.com/download?id=ABC123&export=download&confirm=t": () => new Response(BOT),
      "https://raw.githubusercontent.com/o/r/main/bot.xml": () => new Response(BOT),
    });
    await extractFromUrl("https://drive.google.com/file/d/ABC123/view?usp=sharing", opts());
    await extractFromUrl("https://github.com/o/r/blob/main/bot.xml", opts());
    expect(calls[0]).toContain("drive.usercontent.google.com");
  });
  it("blocks a redirect to a private address", async () => {
    mockWeb({ "https://a.com/r": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }) });
    await expect(extractFromUrl("https://a.com/r", opts())).rejects.toMatchObject({ code: "PRIVATE_DESTINATION_BLOCKED" });
  });
  it("classifies errors: 404 permanent, 503 transient, no bot found", async () => {
    mockWeb({ "https://a.com/404": () => new Response("x", { status: 404 }), "https://a.com/503": () => new Response("x", { status: 503 }), "https://a.com/plain": () => html("<p>hello</p>") });
    await expect(extractFromUrl("https://a.com/404", opts())).rejects.toMatchObject({ code: "SOURCE_HTTP_404", transient: false });
    await expect(extractFromUrl("https://a.com/503", opts())).rejects.toMatchObject({ code: "SOURCE_HTTP_503", transient: true });
    await expect(extractFromUrl("https://a.com/plain", opts())).rejects.toMatchObject({ code: "BOT_DATA_NOT_FOUND" });
  });
  it("enforces the size cap", async () => {
    mockWeb({ "https://a.com/big": () => new Response("x".repeat(2000)) });
    await expect(extractFromUrl("https://a.com/big", { ...opts(), env: { ...env, MAX_SOURCE_BYTES: "1000" } })).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });
});

describe("extractFromUpload", () => {
  it("accepts raw xml and rejects junk", async () => {
    expect((await extractFromUpload(new TextEncoder().encode(BOT), "Scalper.xml")).botName).toBe("Scalper");
    await expect(extractFromUpload(new TextEncoder().encode("nope"), "x.xml")).rejects.toMatchObject({ code: "INVALID_OR_UNSUPPORTED_BOT_XML" });
  });
});
