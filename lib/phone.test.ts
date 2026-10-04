import { describe, expect, it } from "vitest";
import { normalizeKenyanPhone } from "./phone";

describe("normalizeKenyanPhone", () => {
  it.each([
    ["0712345678", "+254712345678"], ["0112 345 678", "+254112345678"], ["712345678", "+254712345678"],
    ["254712345678", "+254712345678"], ["+254 712-345-678", "+254712345678"], ["+254701059192", "+254701059192"],
  ])("accepts %s", (input, out) => expect(normalizeKenyanPhone(input)).toBe(out));
  it.each(["", "12345", "0612345678", "+255712345678", "07123456789", "abc"])("rejects %s", (input) => expect(normalizeKenyanPhone(input)).toBeNull());
});
