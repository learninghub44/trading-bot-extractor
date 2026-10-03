import { envNum, envStr, type AppEnv } from "../env";
import { rewriteKnownSource } from "./adapters";
import { findCandidates } from "./candidates";
import { EngineError, toEngineError } from "./errors";
import { DEFAULT_FETCH, safeFetch, type FetchOptions } from "./fetcher";
import { browserConfigured, renderPage } from "./render";
import { filenameHint, scanDocument, scanText } from "./scan";
import { validateUrlShape } from "./ssrf";
import { decodeBytes } from "./xml";

export interface ExtractionResult {
  xml: string;
  filename: string;
  strategy: string;
  botName: string;
  sha256: string;
  size: number;
}

export interface ExtractOptions {
  env: AppEnv;
  /** Allow Cloudflare Browser Rendering (slow); the cron path enables it, the inline path doesn't. */
  allowBrowser: boolean;
  /** Absolute epoch-ms deadline for the whole extraction. */
  deadline: number;
}

function fetchOptions(env: AppEnv): Partial<FetchOptions> {
  return {
    maxBytes: envNum(env, "MAX_SOURCE_BYTES", DEFAULT_FETCH.maxBytes),
    timeoutMs: envNum(env, "SOURCE_TIMEOUT_MS", DEFAULT_FETCH.timeoutMs),
    dnsCheck: envStr(env, "DNS_CHECK") !== "off",
  };
}

const finish = (hit: Awaited<ReturnType<typeof scanText>> & object): ExtractionResult => ({
  xml: hit.xml,
  filename: `${hit.botName.replace(/[^\w.-]+/g, "_").slice(0, 80) || "trading-bot"}.xml`,
  strategy: hit.strategy,
  botName: hit.botName,
  sha256: hit.sha256,
  size: hit.size,
});

/**
 * Extract a bot from a public URL. Strategy order (cheap → expensive), sharing one fetch budget:
 *  1. known-host share-link rewrites (Drive, Dropbox, GitHub, Gist, Pastebin, GitLab)
 *  2. the URL itself: raw XML / JSON / HTML / ZIP, incl. escaped, base64 and script-embedded XML
 *  3. best-scored linked files, two levels deep
 *  4. Cloudflare Browser Rendering for JS-rendered pages (when allowed and configured)
 */
export async function extractFromUrl(rawUrl: string, options: ExtractOptions): Promise<ExtractionResult> {
  const { env, deadline } = options;
  validateUrlShape(rawUrl);
  const fo = fetchOptions(env);
  const maxFetches = envNum(env, "MAX_FETCHES_PER_JOB", 14);
  const maxCandidates = envNum(env, "MAX_CANDIDATES_PER_PAGE", 8);
  const seen = new Set<string>();
  let fetches = 0;
  let lastError: EngineError | null = null;
  let sawDocument = false;

  const timeLeft = () => deadline - Date.now();
  const load = async (url: string) => {
    if (seen.has(url)) return null;
    seen.add(url);
    if (fetches >= maxFetches || timeLeft() < 2000) return null;
    fetches++;
    try {
      const doc = await safeFetch(url, { ...fo, timeoutMs: Math.min(fo.timeoutMs ?? 15_000, Math.max(2000, timeLeft() - 500)) });
      sawDocument = true;
      return doc;
    } catch (error) {
      lastError = toEngineError(error);
      return null;
    }
  };

  const queue: { url: string; depth: number }[] = [
    ...rewriteKnownSource(rawUrl).map((url) => ({ url, depth: 0 })),
    { url: rawUrl, depth: 0 },
  ];

  while (queue.length) {
    const { url, depth } = queue.shift()!;
    const doc = await load(url);
    if (!doc) continue;
    const hint = filenameHint(doc.url, doc.disposition);
    const hit = await scanDocument(doc.bytes, depth === 0 ? "direct" : "linked", hint);
    if (hit) return finish(hit);
    if (depth < 2) {
      const text = decodeBytes(doc.bytes);
      const links = findCandidates(doc.url, text, maxCandidates);
      // Rewrite known hosts for discovered links too, trying the direct form first.
      for (const link of links) {
        for (const rewritten of rewriteKnownSource(link)) queue.push({ url: rewritten, depth: depth + 1 });
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  if (options.allowBrowser && browserConfigured(env) && timeLeft() > 20_000) {
    try {
      const html = await renderPage(env, rawUrl, Math.min(45_000, timeLeft() - 2000));
      const hit = await scanText(html, "browser");
      if (hit) return finish(hit);
      for (const link of findCandidates(rawUrl, html, maxCandidates)) {
        if (seen.has(link)) continue;
        const doc = await load(link);
        if (!doc) continue;
        const linked = await scanDocument(doc.bytes, "browser-linked", filenameHint(doc.url, doc.disposition));
        if (linked) return finish(linked);
      }
    } catch (error) {
      lastError = toEngineError(error);
    }
  }

  // Nothing found. If we never reached any document, surface why (so transient errors get retried).
  if (!sawDocument && lastError) throw lastError;
  throw new EngineError("BOT_DATA_NOT_FOUND");
}

/** Paid uploads: XML, JSON containing XML, HTML/text containing XML, or a ZIP of those. */
export async function extractFromUpload(bytes: Uint8Array, filename: string): Promise<ExtractionResult> {
  const hit = await scanDocument(bytes, "upload", filenameHint(filename, ""));
  if (!hit) throw new EngineError("INVALID_OR_UNSUPPORTED_BOT_XML");
  return finish(hit);
}
