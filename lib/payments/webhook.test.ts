import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signCallbackReference } from "../payhero";

// Exact callback sample from docs.payhero.co.ke, with our reference/amount.
const callback = (over: Record<string, unknown> = {}) => ({
  forward_url: "",
  response: { Amount: 100, CheckoutRequestID: "ws_CO_1", ExternalReference: "TBE-abc", MerchantRequestID: "m-1", MpesaReceiptNumber: "SAE3YULR0Y", Phone: "+254701059192", ResultCode: 0, ResultDesc: "The service request is processed successfully.", Status: "Success", ...over },
  status: true,
});

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "http://db.test", SUPABASE_SERVICE_ROLE_KEY: "k", PAYHERO_WEBHOOK_SECRET: "whsec", DNS_CHECK: "off" };

function fakeDb(order: { status: string; amount_kes: number } | null) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  let status = order?.status;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const table = url.pathname.split("/").pop();
    if (url.pathname.includes("/rpc/")) return Response.json([]);
    if (table === "orders" && method === "GET") return order ? Response.json({ id: "o1", amount_kes: order.amount_kes, status, source_url: "https://a.com/bot.xml", bulk_job_id: null }) : new Response(null, { status: 406 });
    if (table === "orders" && method === "PATCH") {
      const allowed = (url.searchParams.get("status") ?? "").replace(/^(eq|in)\./, "").replace(/[()]/g, "").split(",");
      if (!allowed.includes(status!)) return Response.json([]);
      status = (body as { status?: string }).status ?? status;
      return Response.json([{ id: "o1" }]);
    }
    return method === "GET" ? Response.json([]) : new Response(null, { status: 204 });
  });
  return { calls, get status() { return status; } };
}

const post = async (payload: unknown, ref = "TBE-abc", sig?: string) => {
  const { POST } = await import("../../app/api/webhooks/payhero/route");
  return POST(new Request(`https://site.test/api/webhooks/payhero?sig=${sig ?? signCallbackReference(ENV, ref)}`, { method: "POST", body: JSON.stringify(payload) }));
};

beforeAll(() => { Object.assign(process.env, ENV); });
afterEach(() => vi.unstubAllGlobals());

describe("PayHero webhook (documented payload)", () => {
  it("marks the order PAID and creates the extraction job on ResultCode 0", async () => {
    const db = fakeDb({ status: "PAYMENT_PENDING", amount_kes: 100 });
    expect((await post(callback())).status).toBe(200);
    expect(db.status).toBe("PAID");
    expect(db.calls.some((c) => c.path.endsWith("/extraction_jobs") && c.method === "POST")).toBe(true);
  });
  it("a duplicate callback does not create a second job", async () => {
    const db = fakeDb({ status: "PAID", amount_kes: 100 });
    await post(callback());
    expect(db.calls.some((c) => c.path.endsWith("/extraction_jobs") && c.method === "POST")).toBe(false);
  });
  it("marks PAYMENT_FAILED when the customer cancels", async () => {
    const db = fakeDb({ status: "PAYMENT_PENDING", amount_kes: 100 });
    await post(callback({ ResultCode: 1032, Status: "Failed", ResultDesc: "Request cancelled by user" }));
    expect(db.status).toBe("PAYMENT_FAILED");
  });
  it("does not release an order when the amount differs", async () => {
    const db = fakeDb({ status: "PAYMENT_PENDING", amount_kes: 100 });
    await post(callback({ Amount: 1 }));
    expect(db.status).toBe("PAYMENT_PENDING");
  });
  it("rejects a callback without a valid signature", async () => {
    const db = fakeDb({ status: "PAYMENT_PENDING", amount_kes: 100 });
    expect((await post(callback(), "TBE-abc", "forged")).status).toBe(401);
    expect(db.status).toBe("PAYMENT_PENDING");
  });
});
