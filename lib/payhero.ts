import { requireEnv } from "./server";

type PaymentInput = {
  reference: string;
  amount: number;
  phone: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  callbackUrl: string;
  redirectUrl: string;
};

export async function createPayHeroPayment(input: PaymentInput) {
  const base = process.env.PAYHERO_BASE_URL || "https://api.payhero.africa";
  const username = requireEnv("PAYHERO_API_USERNAME");
  const password = requireEnv("PAYHERO_API_PASSWORD");

  const body = {
    request_type: "payment",
    transaction_channel: process.env.PAYHERO_TRANSACTION_CHANNEL || "momo",
    provider: requireEnv("PAYHERO_PROVIDER"),
    amount: input.amount,
    currency: "KES",
    country: "KE",
    reason: "Trading bot extraction",
    customer: {
      first_name: input.firstName || "Customer",
      last_name: input.lastName || "Extractor",
      email: input.email,
      phone: input.phone,
      country: "KE",
    },
    vendor_config: { vendor_id: Number(requireEnv("PAYHERO_VENDOR_ID")) },
    provider_config: {
      network_id: requireEnv("PAYHERO_NETWORK_ID"),
      provider_id: process.env.PAYHERO_PROVIDER_ID,
      network_name: requireEnv("PAYHERO_NETWORK_NAME"),
      network_code: requireEnv("PAYHERO_NETWORK_CODE"),
      account_type: process.env.PAYHERO_ACCOUNT_TYPE || "momo",
    },
    payment_config: {
      reference: input.reference,
      account_number: input.phone,
      remark: "Trading bot extraction",
      payment_category: process.env.PAYHERO_PAYMENT_CATEGORY || "bill payment",
      callback_url: input.callbackUrl,
      redirect_url: input.redirectUrl,
    },
  };

  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const response = await fetch(`${base.replace(/\/$/, "")}/api/global/payments`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || "PAYMENT_PROVIDER_ERROR");
  return data;
}
