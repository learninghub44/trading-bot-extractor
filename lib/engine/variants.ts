/** Ways XML hides inside pages, scripts and JSON. Each helper returns decoded text or null. */

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, "&");
}

export function unescapeJs(s: string): string {
  return s
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([nrt"'\/\\])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t" } as Record<string, string>)[c] ?? c);
}

function b64decode(s: string): string | null {
  try {
    const clean = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Decoded views of a text blob worth scanning for XML (original first). */
export function textVariants(text: string): string[] {
  const out = [text];
  if (/&(lt|#0*60|#x3c);/i.test(text)) out.push(decodeHtmlEntities(text));
  if (/\\u003c|\\x3c|\\u\{3c\}|\\"|\\\//i.test(text) && /xml/i.test(text)) out.push(unescapeJs(text));
  if (/%3C(%3F)?xml/i.test(text)) {
    try { out.push(decodeURIComponent(text)); } catch { /* ignore */ }
  }
  let count = 0;
  for (const m of text.matchAll(/(?:PHhtbC|PD94bWw|PGJsb2Nr)[A-Za-z0-9+/_-]{40,}={0,2}/g)) {
    const decoded = b64decode(m[0]);
    if (decoded) out.push(decoded);
    if (++count >= 10) break;
  }
  return [...new Set(out)];
}

/** Find candidate XML documents inside free text: every `<?xml` / `<xml` start, closed at a valid end tag. */
export function xmlFragments(text: string, max = 12): string[] {
  const found: string[] = [];
  const starts = /<\?xml\b|<xml[\s>]/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = starts.exec(text)) && found.length < max && guard++ < 200) {
    let from = m.index;
    let rest = text.slice(from);
    if (/^<\?xml/i.test(rest)) {
      const decl = rest.indexOf("?>");
      if (decl < 0) continue;
      const afterDecl = rest.slice(decl + 2);
      const rootMatch = /<([A-Za-z_][\w.:-]*)/.exec(afterDecl);
      if (!rootMatch) continue;
      rest = rest.slice(0, decl + 2) + afterDecl.slice(rootMatch.index);
      const root = rootMatch[1];
      pushClosings(rest, root, found);
    } else {
      pushClosings(rest, "xml", found);
    }
    from += 1;
  }
  return found;
}

function pushClosings(rest: string, root: string, found: string[]): void {
  const close = `</${root}>`;
  const lower = rest.toLowerCase();
  const needle = close.toLowerCase();
  let idx = lower.indexOf(needle);
  let tries = 0;
  // Prefer the LAST closing tag in the document first (whole bot), then earlier ones.
  const positions: number[] = [];
  while (idx >= 0 && tries++ < 20) { positions.push(idx + close.length); idx = lower.indexOf(needle, idx + 1); }
  for (const end of positions.reverse().slice(0, 6)) found.push(rest.slice(0, end));
}

export function stringLeaves(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 5000) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out, depth + 1);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringLeaves(v, out, depth + 1);
  return out;
}
