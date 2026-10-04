/** Accepts 0712345678, 712345678, 254712345678, +254 712 345 678 (07xx and 01xx lines). Returns +254XXXXXXXXX or null. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(digits);
  return m ? `+254${m[1]}` : null;
}
