import { EngineError, toEngineError } from "./errors";
import { assertPublicHost, validateUrlShape } from "./ssrf";

export interface FetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  dnsCheck: boolean;
  userAgent: string;
}

export interface FetchedDoc {
  url: string;
  bytes: Uint8Array;
  contentType: string;
  disposition: string;
}

export const DEFAULT_FETCH: FetchOptions = {
  maxBytes: 10 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 5,
  dnsCheck: true,
  userAgent: "Mozilla/5.0 (compatible; TradingBotExtractor/1.0)",
};

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new EngineError("SOURCE_TOO_LARGE");
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new EngineError("SOURCE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/** SSRF-safe GET: validates every hop, manual redirects, streaming size cap, timeout. */
export async function safeFetch(rawUrl: string, options: Partial<FetchOptions> = {}): Promise<FetchedDoc> {
  const opts = { ...DEFAULT_FETCH, ...options };
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      const url = validateUrlShape(current);
      await assertPublicHost(url, opts.dnsCheck);
      const response = await fetch(url.toString(), {
        redirect: "manual",
        headers: { "user-agent": opts.userAgent, accept: "*/*" },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new EngineError("REDIRECT_WITHOUT_LOCATION");
        current = new URL(location, url).toString();
        continue;
      }
      if (response.status >= 400) {
        await response.body?.cancel().catch(() => undefined);
        const transient = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        throw new EngineError(`SOURCE_HTTP_${response.status}`, transient);
      }
      return {
        url: url.toString(),
        bytes: await readLimited(response, opts.maxBytes),
        contentType: response.headers.get("content-type") || "",
        disposition: response.headers.get("content-disposition") || "",
      };
    }
    throw new EngineError("TOO_MANY_REDIRECTS");
  } catch (error) {
    throw toEngineError(error);
  }
}
