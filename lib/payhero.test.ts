import { describe, expect, it } from "vitest";
import { buildStkRequest, normalizeStatus, parseCallback, signCallbackReference, toLocalPhone, verifyCallbackSignature } from "./payhero";

const env = { PAYHERO_WEBHOOK_SECRET: "test-secret", PAYHERO_CHANNEL_ID: "911" };

describe("callback signature", () => {
  it("accepts a signature made for the same reference", () => {
    expect(verifyCallbackSignature(env, "TBE-1", signCallbackReference(env, "TBE-1"))).toBe(true);
  });
  it("rejects other references, missing and malformed signatures", () => {
    expect(verifyCallbackSignature(env, "TBE-2", signCallbackReference(env, "TBE-1"))).toBe(false);
    expect(verifyCallbackSignature(env, "TBE-1", null)).toBe(false);
    expect(verifyCallbackSignature(env, "TBE-1", "abc")).toBe(false);
  });
});

describe("STK request (matches PayHero docs)", () => {
  it("builds the documented body", () => {
    expect(buildStkRequest(env, { reference: "TBE-1", amount: 100, phone: "+254701059192", callbackUrl: "https://x/cb" })).toEqual({
      amount: 100, phone_number: "0701059192", channel_id: 911, provider: "m-pesa",
      external_reference: "TBE-1", customer_name: "Customer", callback_url: "https://x/cb",
    });
  });
  it("converts phone formats", () => expect(toLocalPhone("+254112345678")).toBe("0112345678"));
});

// Exact sample from docs.payhero.co.ke (callback_url response)
const DOC_CALLBACK = { forward_url: "", response: { Amount: 10, CheckoutRequestID: "ws_CO_14012024103543427709099876", ExternalReference: "INV-009", MerchantRequestID: "3202-70921557-1", MpesaReceiptNumber: "SAE3YULR0Y", Phone: "+254709099876", ResultCode: 0, ResultDesc: "The service request is processed successfully.", Status: "Success" }, status: true };

describe("parseCallback", () => {
  it("reads the documented success payload", () => {
    expect(parseCallback(DOC_CALLBACK)).toMatchObject({ reference: "INV-009", success: true, amount: 10, receipt: "SAE3YULR0Y", checkoutRequestId: "ws_CO_14012024103543427709099876" });
  });
  it("treats non-zero ResultCode or Failed status as failure", () => {
    const failed = { ...DOC_CALLBACK, response: { ...DOC_CALLBACK.response, ResultCode: 1032, Status: "Failed", ResultDesc: "Request cancelled by user" } };
    expect(parseCallback(failed)).toMatchObject({ success: false, resultCode: 1032 });
    expect(parseCallback({ response: { ExternalReference: "X", ResultCode: 0, Status: "Failed" } })?.success).toBe(false);
  });
  it("ignores bodies without our reference", () => {
    expect(parseCallback({ response: {} })).toBeNull();
    expect(parseCallback(null)).toBeNull();
    expect(parseCallback({ status: true })).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it.each([[{ status: "SUCCESS" }, "success"], [{ status: "Success", amount: 100 }, "success"], [{ status: "FAILED" }, "failed"], [{ status: "QUEUED" }, "pending"], [{}, "pending"], [null, "pending"]])("%j -> %s", (input, state) => {
    expect(normalizeStatus(input).state).toBe(state);
  });
});
