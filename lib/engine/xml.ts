import { XMLParser, XMLValidator } from "fast-xml-parser";

export const MAX_XML_BYTES = 10 * 1024 * 1024;

export interface BotXml {
  xml: string;
  botName: string;
  sha256: string;
  size: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  allowBooleanAttributes: false,
  parseTagValue: false,
});

export function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function collect(node: unknown, tags: Set<string>, blocks: { type?: string }[], depth = 0): void {
  if (depth > 200 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const item of node) collect(item, tags, blocks, depth + 1); return; }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith("@_")) continue;
    if (key === "#text") continue;
    tags.add(key.toLowerCase());
    if (key.toLowerCase() === "block") {
      for (const b of Array.isArray(value) ? value : [value]) {
        blocks.push({ type: b && typeof b === "object" ? (b as Record<string, string>)["@_type"] : undefined });
      }
    }
    collect(value, tags, blocks, depth + 1);
  }
}

const NON_BOT_ROOTS = new Set(["html", "svg", "rss", "feed", "urlset", "sitemapindex", "opml", "kml", "gpx"]);

/**
 * Validate that `text` is a well-formed XML document that is a trading bot (Blockly/Deriv Bot Builder
 * style or another bot/strategy schema). The original document content is preserved, never re-synthesised.
 */
export async function toBotXml(text: string, nameHint?: string): Promise<BotXml | null> {
  const doc = text.replace(/^\uFEFF/, "").trim();
  if (!doc.startsWith("<") || doc.length < 8) return null;
  if (doc.length > MAX_XML_BYTES) return null;
  // XXE / entity-expansion hardening: bot XML never needs a DTD.
  if (/<!ENTITY/i.test(doc) || /<!DOCTYPE/i.test(doc)) return null;
  if (XMLValidator.validate(doc) !== true) return null;

  let parsed: Record<string, unknown>;
  try { parsed = parser.parse(doc); } catch { return null; }
  const rootKey = Object.keys(parsed).find((k) => !k.startsWith("?") && !k.startsWith("#"));
  if (!rootKey) return null;
  const root = rootKey.toLowerCase();
  if (NON_BOT_ROOTS.has(root)) return null;

  const tags = new Set<string>([root]);
  const blocks: { type?: string }[] = [];
  const names: string[] = [];
  collect(parsed[rootKey], tags, blocks);
  const rootAttrs = parsed[rootKey];
  if (rootAttrs && typeof rootAttrs === "object") {
    for (const k of ["@_name", "@_title", "@_bot_name"]) {
      const v = (rootAttrs as Record<string, unknown>)[k];
      if (typeof v === "string" && v) names.unshift(v);
    }
  }

  const blockly = root === "xml" && blocks.length > 0;
  const typedBlocks = blocks.some((b) => b.type);
  const named = [...tags].some((t) => /(^|[_-])(bot|strategy|trade)/.test(t) || /(bot|strategy)$/.test(t));
  if (!blockly && !typedBlocks && !named) return null;

  const withDecl = doc.startsWith("<?xml") ? doc : `<?xml version="1.0" encoding="UTF-8"?>\n${doc}`;
  const bytes = new TextEncoder().encode(withDecl);
  if (bytes.byteLength > MAX_XML_BYTES) return null;
  const botName = (names[0] || nameHint || "trading-bot").slice(0, 120);
  return { xml: withDecl, botName, sha256: await sha256Hex(bytes), size: bytes.byteLength };
}
