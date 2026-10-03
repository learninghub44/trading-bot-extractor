import { beforeAll, describe, expect, it } from "vitest";
import { signCallbackReference, verifyCallbackSignature } from "./payhero";

beforeAll(() => {
  process.env.PAYHERO_WEBHOOK_SECRET = "test-secret";
});

describe("callback signature", () => {
  it("accepts a signature made for the same reference", () => {
    expect(verifyCallbackSignature("TBE-1", signCallbackReference("TBE-1"))).toBe(true);
  });
  it("rejects a signature for a different reference", () => {
    expect(verifyCallbackSignature("TBE-2", signCallbackReference("TBE-1"))).toBe(false);
  });
  it("rejects missing, empty and malformed signatures", () => {
    expect(verifyCallbackSignature("TBE-1", null)).toBe(false);
    expect(verifyCallbackSignature("TBE-1", "")).toBe(false);
    expect(verifyCallbackSignature("TBE-1", "abc")).toBe(false);
  });
});
