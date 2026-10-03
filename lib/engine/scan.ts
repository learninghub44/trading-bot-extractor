import { unzipSync } from "fflate";
import { MAX_XML_BYTES, decodeBytes, toBotXml, type BotXml } from "./xml";
import { stringLeaves, textVariants, xmlFragments } from "./variants";

export interface ScanHit extends BotXml {
  strategy: string;
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

export function filenameHint(url: string, disposition: string): string | undefined {
  const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  let name = fromHeader ? decodeURIComponent(fromHeader) : undefined;
  if (!name) {
    try { name = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { name = url.split("/").pop(); }
  }
  name = name?.replace(/\.(xml|dbot|json|zip|txt|html?)$/i, "").trim();
  return name && name.length > 1 ? name : undefined;
}

async function tryText(text: string, strategy: string, hint?: string): Promise<ScanHit | null> {
  const whole = await toBotXml(text, hint);
  if (whole) return { ...whole, strategy };
  for (const fragment of xmlFragments(text)) {
    const hit = await toBotXml(fragment, hint);
    if (hit) return { ...hit, strategy: `${strategy}-embedded` };
  }
  return null;
}

async function scanJson(value: unknown, strategy: string, hint: string | undefined, depth = 0): Promise<ScanHit | null> {
  for (const leaf of stringLeaves(value)) {
    if (leaf.length < 20) continue;
    for (const variant of textVariants(leaf)) {
      const hit = await tryText(variant, `${strategy}-json`, hint);
      if (hit) return hit;
    }
    // JSON nested in a JSON string.
    if (depth < 3 && /^\s*[[{]/.test(leaf)) {
      try {
        const nested = await scanJson(JSON.parse(leaf), strategy, hint, depth + 1);
        if (nested) return nested;
      } catch { /* not JSON */ }
    }
  }
  return null;
}

export async function scanText(text: string, strategy: string, hint?: string): Promise<ScanHit | null> {
  for (const variant of textVariants(text)) {
    const hit = await tryText(variant, strategy, hint);
    if (hit) return hit;
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const hit = await scanJson(JSON.parse(text), strategy, hint);
      if (hit) return hit;
    } catch { /* not JSON */ }
  }
  // JSON blobs assigned inside <script> tags (e.g. __NEXT_DATA__, window.__STATE__ = {...}).
  for (const m of text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1].trim();
    if (body.length < 40) continue;
    const jsonStart = body.search(/[{[]/);
    if (jsonStart < 0) continue;
    try {
      const hit = await scanJson(JSON.parse(body.slice(jsonStart).replace(/;\s*$/, "")), `${strategy}-script`, hint);
      if (hit) return hit;
    } catch { /* not pure JSON */ }
  }
  return null;
}

/** Scan any downloaded document: raw XML, JSON, HTML/JS, or a ZIP containing any of those. */
export async function scanDocument(bytes: Uint8Array, strategy: string, hint?: string): Promise<ScanHit | null> {
  if (isZip(bytes)) {
    let files: Record<string, Uint8Array> = {};
    try {
      let budget = MAX_XML_BYTES * 2;
      files = unzipSync(bytes, {
        filter: (f) => {
          if (f.name.endsWith("/") || f.originalSize > MAX_XML_BYTES || budget - f.originalSize < 0) return false;
          budget -= f.originalSize;
          return /\.(xml|dbot|json|txt|html?)$/i.test(f.name);
        },
      });
    } catch { return null; }
    const entries = Object.entries(files)
      .sort(([a], [b]) => Number(/\.(xml|dbot)$/i.test(b)) - Number(/\.(xml|dbot)$/i.test(a)))
      .slice(0, 50);
    for (const [name, data] of entries) {
      const hit = await scanText(decodeBytes(data), `${strategy}-zip`, filenameHint(name, "") ?? hint);
      if (hit) return hit;
    }
    return null;
  }
  return scanText(decodeBytes(bytes), strategy, hint);
}
