import { decodeHtmlEntities } from "./variants";

const STATIC_EXT = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp[34]|webm|pdf)(?:[?#]|$)/i;
const SKIP_HOSTS = /(?:google-analytics|googletagmanager|doubleclick|facebook\.net|facebook\.com\/tr|fonts\.g|gstatic|cloudflareinsights|hotjar|sentry|schema\.org|w3\.org|youtube\.com|ytimg)/i;
const HINT = /(?:download|export|bot|strategy|xml|raw|file|attachment|asset|dbot|blob|get)/i;

export function scoreCandidate(url: string, base: string): number {
  let score = 0;
  if (/\.(?:xml|dbot)(?:[?#]|$)/i.test(url)) score += 8;
  if (/\.(?:zip|json|txt)(?:[?#]|$)/i.test(url)) score += 4;
  if (HINT.test(url)) score += 3;
  try { if (new URL(url).origin === new URL(base).origin) score += 2; } catch { /* ignore */ }
  return score;
}

/** Links worth following from an HTML/JSON/JS document, best first. */
export function findCandidates(base: string, text: string, max: number): string[] {
  const body = decodeHtmlEntities(text.replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/\\u002f/gi, "/"));
  const found = new Set<string>();

  const add = (value: string | undefined) => {
    if (!value) return;
    const v = value.trim();
    if (!v || /^(?:javascript:|data:|mailto:|tel:|#)/i.test(v) || v.length > 2048) return;
    try {
      const abs = new URL(v, base).toString();
      if (!/^https?:/i.test(abs) || STATIC_EXT.test(abs) || SKIP_HOSTS.test(abs)) return;
      found.add(abs);
    } catch { /* ignore */ }
  };

  for (const m of body.matchAll(/\b(?:href|src|action|data-[\w-]*(?:url|href|src|download|file|link)[\w-]*)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of body.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) add(m[0].replace(/[.,;]+$/, ""));
  // Relative paths inside JS/JSON strings that look like downloadable files.
  for (const m of body.matchAll(/["'](\/?[\w./%-]+\.(?:xml|dbot|zip|json)(?:\?[^"']*)?)["']/gi)) add(m[1]);

  return [...found]
    .map((u) => ({ u, s: scoreCandidate(u, base) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.u);
}
