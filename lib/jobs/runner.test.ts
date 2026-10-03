import { afterEach, describe, expect, it, vi } from "vitest";
import { runPendingJobs } from "./runner";
import { signedDownloadPath, verifyDownloadToken } from "../storage";

const BOT = `<xml><block type="trade_definition" id="1"></block></xml>`;

function fakeStack(job: { id: string; source_url: string; attempts: number }, source: () => Response) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  const objects = new Map<string, Uint8Array>();
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    if (url.hostname === "db.test") {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      writes.push({ path: url.pathname, method: init?.method ?? "GET", body });
      if (url.pathname.endsWith("/rpc/claim_extraction_jobs")) return Response.json([job]);
      if (url.pathname.includes("/rpc/")) return new Response(null, { status: 204 });
      if ((init?.method ?? "GET") === "GET") return Response.json([]);
      return new Response(null, { status: 204 });
    }
    return source();
  });
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "http://db.test", SUPABASE_SERVICE_ROLE_KEY: "k", DNS_CHECK: "off", DOWNLOAD_SIGNING_SECRET: "s3cret",
    RESULTS: { put: async (k: string, v: Uint8Array) => { objects.set(k, v); }, get: async () => null, delete: async () => undefined },
  };
  return { env, writes, objects };
}
const rpcCall = (w: { path: string; body: unknown }[], name: string) => w.find((x) => x.path.endsWith(`/rpc/${name}`))?.body as Record<string, unknown> | undefined;

afterEach(() => vi.unstubAllGlobals());

describe("runPendingJobs", () => {
  it("claims, extracts, stores in R2 and completes the job", async () => {
    const { env, writes, objects } = fakeStack({ id: "job1", source_url: "https://a.com/bot.xml", attempts: 1 }, () => new Response(BOT));
    expect(await runPendingJobs(env, { mode: "inline" })).toBe(1);
    const done = rpcCall(writes, "complete_extraction_job")!;
    expect(done).toMatchObject({ p_id: "job1", p_status: "COMPLETED", p_filename: "bot.xml" });
    expect([...objects.keys()][0]).toMatch(/^results\/job1\/[0-9a-f]{64}\.xml$/);
    expect(new TextDecoder().decode(objects.values().next().value)).toContain("trade_definition");
  });

  it("retries transient failures instead of failing the paid job", async () => {
    const { env, writes } = fakeStack({ id: "job2", source_url: "https://a.com/x", attempts: 1 }, () => new Response("down", { status: 503 }));
    await runPendingJobs(env, { mode: "inline" });
    expect(rpcCall(writes, "complete_extraction_job")).toBeUndefined();
    const release = writes.find((w) => w.method === "PATCH" && w.path.endsWith("/extraction_jobs"))!.body as Record<string, unknown>;
    expect(release).toMatchObject({ status: "PAID", error_code: "SOURCE_HTTP_503" });
  });

  it("defers 'no bot found' to a browser-enabled attempt, then fails permanently", async () => {
    const page = () => new Response("<p>hi</p>", { headers: { "content-type": "text/html" } });
    const first = fakeStack({ id: "job3", source_url: "https://a.com/p", attempts: 1 }, page);
    await runPendingJobs(first.env, { mode: "inline" });
    expect(rpcCall(first.writes, "complete_extraction_job")).toBeUndefined();
    const last = fakeStack({ id: "job3", source_url: "https://a.com/p", attempts: 2 }, page);
    await runPendingJobs(last.env, { mode: "inline" });
    expect(rpcCall(last.writes, "complete_extraction_job")).toMatchObject({ p_status: "FAILED", p_error_code: "BOT_DATA_NOT_FOUND" });
  });

  it("fails permanent errors immediately (404, blocked destination)", async () => {
    const a = fakeStack({ id: "j4", source_url: "https://a.com/gone", attempts: 1 }, () => new Response("x", { status: 404 }));
    await runPendingJobs(a.env, { mode: "inline" });
    expect(rpcCall(a.writes, "complete_extraction_job")).toMatchObject({ p_status: "FAILED", p_error_code: "SOURCE_HTTP_404" });
    const b = fakeStack({ id: "j5", source_url: "http://169.254.169.254/", attempts: 1 }, () => new Response(BOT));
    await runPendingJobs(b.env, { mode: "inline" });
    expect(rpcCall(b.writes, "complete_extraction_job")).toMatchObject({ p_status: "FAILED", p_error_code: "PRIVATE_DESTINATION_BLOCKED" });
  });

  it("stops after max attempts", async () => {
    const { env, writes } = fakeStack({ id: "j6", source_url: "https://a.com/x", attempts: 4 }, () => new Response(BOT));
    await runPendingJobs(env, { mode: "cron" });
    expect(rpcCall(writes, "complete_extraction_job")).toMatchObject({ p_status: "FAILED", p_error_code: "MAX_ATTEMPTS_EXCEEDED" });
  });
});

describe("signed downloads", () => {
  const env = { DOWNLOAD_SIGNING_SECRET: "s3cret", DOWNLOAD_TTL_SECONDS: "900" };
  it("round-trips and rejects tampering and expiry", () => {
    const { path } = signedDownloadPath(env, "results/a.xml", "bot.xml");
    const token = path.split("/").pop()!;
    expect(verifyDownloadToken(env, token)).toMatchObject({ key: "results/a.xml", filename: "bot.xml" });
    expect(verifyDownloadToken(env, token.slice(0, -2) + "xx")).toBeNull();
    expect(verifyDownloadToken({ ...env, DOWNLOAD_SIGNING_SECRET: "other" }, token)).toBeNull();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 901_000);
    expect(verifyDownloadToken(env, token)).toBeNull();
    vi.useRealTimers();
  });
});
