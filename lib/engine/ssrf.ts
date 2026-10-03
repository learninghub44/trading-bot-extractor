import { EngineError } from "./errors";

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".lan", ".home", ".corp", ".intranet"];

export function isPrivateIPv4(parts: number[]): boolean {
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function expandIPv6(host: string): number[] | null {
  let h = host.toLowerCase();
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (v4) {
    const p = parseIPv4(v4[1]);
    if (!p) return null;
    h = h.slice(0, v4.index) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPrivateIPv6(host: string): boolean {
  const g = expandIPv6(host);
  if (!g) return true; // unparseable: fail closed
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  const embedded = (hi: number, lo: number) => isPrivateIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  return false;
}

/** Synchronous checks on the URL itself. Returns the parsed URL. */
export function validateUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EngineError("INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new EngineError("INVALID_URL");
  if (url.username || url.password) throw new EngineError("PRIVATE_DESTINATION_BLOCKED");
  if (!ALLOWED_PORTS.has(url.port)) throw new EngineError("PRIVATE_DESTINATION_BLOCKED");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new EngineError("INVALID_URL");
  if (host.startsWith("[")) {
    if (isPrivateIPv6(host.slice(1, -1))) throw new EngineError("PRIVATE_DESTINATION_BLOCKED");
    return url;
  }
  const v4 = parseIPv4(host);
  if (v4) {
    if (isPrivateIPv4(v4)) throw new EngineError("PRIVATE_DESTINATION_BLOCKED");
    return url;
  }
  if (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new EngineError("PRIVATE_DESTINATION_BLOCKED");
  }
  return url;
}

const dnsCache = new Map<string, number>();

/**
 * Defence in depth: resolve the hostname via Cloudflare DoH and refuse private answers
 * (e.g. 127.0.0.1.nip.io). Workers cannot reach private networks anyway, so a DoH outage fails open.
 */
export async function assertPublicHost(url: URL, enabled = true): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!enabled || host.startsWith("[") || parseIPv4(host)) return;
  const cachedAt = dnsCache.get(host);
  if (cachedAt && Date.now() - cachedAt < 5 * 60_000) return;

  for (const type of ["A", "AAAA"] as const) {
    let json: { Status?: number; Answer?: { type: number; data: string }[] } | null = null;
    try {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) json = await res.json();
    } catch {
      return; // fail open
    }
    if (!json) return;
    if (type === "A" && json.Status === 3) throw new EngineError("HOST_RESOLUTION_FAILED");
    for (const answer of json.Answer ?? []) {
      const v4 = answer.type === 1 ? parseIPv4(answer.data) : null;
      if ((v4 && isPrivateIPv4(v4)) || (answer.type === 28 && isPrivateIPv6(answer.data))) {
        throw new EngineError("PRIVATE_DESTINATION_BLOCKED");
      }
    }
  }
  dnsCache.set(host, Date.now());
}
