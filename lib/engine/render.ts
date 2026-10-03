import { envStr, type AppEnv } from "../env";
import { EngineError } from "./errors";
import { validateUrlShape } from "./ssrf";

export function browserConfigured(env: AppEnv): boolean {
  return Boolean(envStr(env, "CF_ACCOUNT_ID") && envStr(env, "CF_BROWSER_RENDERING_TOKEN"));
}

/** Render a public page with Cloudflare Browser Rendering (REST) and return the final HTML. */
export async function renderPage(env: AppEnv, rawUrl: string, timeoutMs = 45_000): Promise<string> {
  const url = validateUrlShape(rawUrl);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${envStr(env, "CF_ACCOUNT_ID")}/browser-rendering/content`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${envStr(env, "CF_BROWSER_RENDERING_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify({
        url: url.toString(),
        gotoOptions: { waitUntil: "networkidle0", timeout: 30_000 },
        rejectResourceTypes: ["image", "media", "font"],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!res.ok) throw new EngineError(`BROWSER_HTTP_${res.status}`, res.status === 429 || res.status >= 500);
  const json = (await res.json()) as { success?: boolean; result?: string };
  if (!json.success || typeof json.result !== "string") throw new EngineError("BROWSER_RENDER_FAILED", true);
  return json.result;
}
