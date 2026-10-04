import { describe, expect, it, vi } from "vitest";
import { withApi } from "./api";
import { ConfigError } from "./env";
import { callApi } from "./client";

describe("withApi", () => {
  it("turns a missing-config throw into a JSON 503, never an empty body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await withApi(async () => { throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY"); })();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it("turns any other throw into a JSON 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await withApi(async () => { throw new Error("boom"); })();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL_ERROR");
  });
});

describe("callApi", () => {
  it("survives an empty 500 body with a readable message", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    const r = await callApi("/x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/server had a problem/i);
    vi.unstubAllGlobals();
  });
  it("survives network failure", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fail"); });
    expect((await callApi("/x")).error).toMatch(/can't reach/i);
    vi.unstubAllGlobals();
  });
});
