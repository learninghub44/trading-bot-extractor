export const PACKAGES = [
  { code: "single", name: "Single extraction", quantity: 1, priceKes: Number(process.env.SINGLE_EXTRACTION_PRICE_KES || 100) },
  { code: "bulk10", name: "10 extractions", quantity: 10, priceKes: Number(process.env.BULK_10_PRICE_KES || 900) },
  { code: "bulk25", name: "25 extractions", quantity: 25, priceKes: Number(process.env.BULK_25_PRICE_KES || 2000) },
  { code: "bulk50", name: "50 extractions", quantity: 50, priceKes: Number(process.env.BULK_50_PRICE_KES || 3750) },
  { code: "bulk100", name: "100 extractions", quantity: 100, priceKes: Number(process.env.BULK_100_PRICE_KES || 7000) },
] as const;

export function packageByCode(code: string) {
  return PACKAGES.find((item) => item.code === code);
}
