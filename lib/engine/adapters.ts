/**
 * Source adapters: rewrite well-known public share links to their direct-download form.
 * Only public links are rewritten; nothing here bypasses access controls.
 */
export function rewriteKnownSource(raw: string): string[] {
  let url: URL;
  try { url = new URL(raw); } catch { return []; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;
  const out: string[] = [];

  if (host === "drive.google.com" || host === "drive.usercontent.google.com") {
    const id = /\/file\/d\/([\w-]+)/.exec(path)?.[1] ?? url.searchParams.get("id");
    if (id) {
      out.push(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
      out.push(`https://drive.google.com/uc?export=download&id=${id}`);
    }
  } else if (host === "docs.google.com") {
    const doc = /\/document\/d\/([\w-]+)/.exec(path)?.[1];
    if (doc) out.push(`https://docs.google.com/document/d/${doc}/export?format=txt`);
  } else if (host === "dropbox.com" || host.endsWith(".dropbox.com")) {
    const u = new URL(url); u.searchParams.delete("dl"); u.searchParams.set("dl", "1");
    out.push(u.toString());
    const raw2 = new URL(url); raw2.hostname = "dl.dropboxusercontent.com"; raw2.searchParams.delete("dl");
    out.push(raw2.toString());
  } else if (host === "github.com") {
    const m = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(path);
    if (m) out.push(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
  } else if (host === "gist.github.com") {
    const m = /^\/([^/]+)\/([0-9a-f]+)/i.exec(path);
    if (m) out.push(`https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`);
  } else if (host === "pastebin.com") {
    const id = /^\/(?:raw\/)?(\w+)$/.exec(path)?.[1];
    if (id && !/^raw$/.test(id)) out.push(`https://pastebin.com/raw/${id}`);
  } else if (host === "gitlab.com") {
    if (path.includes("/-/blob/")) out.push(url.toString().replace("/-/blob/", "/-/raw/"));
  }
  return out;
}
