import { createHmac, timingSafeEqual } from "crypto";
import { envStr, requireStr, type AppEnv } from "./env";

/**
 * PayHero Kenya (https://payhero.co.ke) — M-Pesa STK Push.
 * Docs: POST {base}/payments (Basic auth), callback JSON with response.ExternalReference / ResultCode,
 * GET {base}/transaction-status?reference=<PayHero reference>.
 */
const DEFAULT_BASE = "https://backend.payhero.co.ke/api/v2";

export function payHeroBase(env: AppEnv) {
  return (envStr(env, "PAYHERO_BASE_URL") || DEFAULT_BASE).replace(/\/$/, "");
}

/** Throws ConfigError (→ 503) before any order is created if payments aren't configured. */
export function assertPayHeroConfigured(env: AppEnv) {
  for (const name of ["PAYHERO_API_USERNAME", "PAYHERO_API_PASSWORD", "PAYHERO_CHANNEL_ID", "PAYHERO_WEBHOOK_SECRET"]) requireStr(env, name);
  if (!Number.isInteger(Number(requireStr(env, "PAYHERO_CHANNEL_ID")))) throw new Error("PAYHERO_CHANNEL_ID must be a number");
}

function authHeader(env: AppEnv) {
  const token = Buffer.from(`${requireStr(env, "PAYHERO_API_USERNAME")}:${requireStr(env, "PAYHERO_API_PASSWORD")}`).toString("base64");
  return `Basic ${token}`;
}

/** +254712345678 -> 0712345678 (the format used in PayHero's docs). */
export function toLocalPhone(e164: string) {
  return `0${e164.replace(/^\+?254/, "")}`;
}

export interface StkInput {
  reference: string;
  amount: number;
  phone: string; // +2547XXXXXXXX
  customerName?: string;
  callbackUrl: string;
}

export function buildStkRequest(env: AppEnv, input: StkInput) {
  return {
    amount: Math.round(input.amount),
    phone_number: toLocalPhone(input.phone),
    channel_id: Number(requireStr(env, "PAYHERO_CHANNEL_ID")),
    provider: envStr(env, "PAYHERO_PROVIDER") || "m-pesa",
    external_reference: input.reference,
    customer_name: input.customerName || "Customer",
    callback_url: input.callbackUrl,
  };
}

export interface StkResponse {
  success?: boolean;
  status?: string; // "QUEUED"
  reference?: string; // PayHero's reference (use for transaction-status)
  CheckoutRequestID?: string;
  [key: string]: unknown;
}

export class PayHeroError extends Error {
  constructor(message: string, public httpStatus: number) { super(message); this.name = "PayHeroError"; }
}

export async function createPayHeroPayment(env: AppEnv, input: StkInput): Promise<StkResponse> {
  const response = await fetch(`${payHeroBase(env)}/payments`, {
    method: "POST",
    headers: { Authorization: authHeader(env), "Content-Type": "application/json" },
    body: JSON.stringify(buildStkRequest(env, input)),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: StkResponse = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!response.ok || data.success === false) {
    const message = String(data.error_message ?? data.message ?? data.error ?? `PayHero HTTP ${response.status}`);
    throw new PayHeroError(message.slice(0, 300), response.status);
  }
  return data;
}

export type PayState = "success" | "failed" | "pending";

const OK = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID"]);
const BAD = new Set(["FAILED", "CANCELLED", "CANCELED", "EXPIRED", "DECLINED", "REJECTED", "TIMEOUT", "TIMED_OUT"]);

/** Lenient reader for transaction-status responses (exact schema isn't published). Unknown ⇒ pending. */
export function normalizeStatus(data: unknown): { state: PayState; raw: string; amount?: number } {
  const d = (data ?? {}) as Record<string, unknown>;
  const inner = (d.response && typeof d.response === "object" ? d.response : {}) as Record<string, unknown>;
  const raw = String(d.status ?? d.Status ?? inner.Status ?? "").toUpperCase();
  const resultCode = d.ResultCode ?? inner.ResultCode;
  const amount = Number(d.amount ?? d.Amount ?? inner.Amount);
  const base = Number.isFinite(amount) ? { amount } : {};
  if (OK.has(raw) || resultCode === 0) return { state: "success", raw, ...base };
  if (BAD.has(raw) || (resultCode !== undefined && resultCode !== 0)) return { state: "failed", raw, ...base };
  return { state: "pending", raw, ...base };
}

export async function getPayHeroStatus(env: AppEnv, payheroReference: string) {
  const res = await fetch(`${payHeroBase(env)}/transaction-status?reference=${encodeURIComponent(payheroReference)}`, {
    headers: { Authorization: authHeader(env) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new PayHeroError(`status HTTP ${res.status}`, res.status);
  return res.json().catch(() => ({}));
}

export interface CallbackInfo {
  reference: string; // our external reference
  success: boolean;
  amount?: number;
  receipt?: string;
  checkoutRequestId?: string;
  resultCode?: number;
  resultDesc?: string;
}

/** PayHero callback: { forward_url, response: { Amount, CheckoutRequestID, ExternalReference, MpesaReceiptNumber, ResultCode, ResultDesc, Status, ... }, status } */
export function parseCallback(body: unknown): CallbackInfo | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const r = (b.response && typeof b.response === "object" ? b.response : b) as Record<string, unknown>;
  const reference = String(r.ExternalReference ?? r.external_reference ?? "");
  if (!reference) return null;
  const resultCode = r.ResultCode === undefined ? undefined : Number(r.ResultCode);
  const statusText = String(r.Status ?? "").toLowerCase();
  const success = resultCode === 0 && (statusText === "" || statusText === "success");
  const amount = r.Amount === undefined ? undefined : Number(r.Amount);
  return {
    reference, success,
    amount: Number.isFinite(amount) ? amount : undefined,
    receipt: r.MpesaReceiptNumber ? String(r.MpesaReceiptNumber) : undefined,
    checkoutRequestId: r.CheckoutRequestID ? String(r.CheckoutRequestID) : undefined,
    resultCode: resultCode !== undefined && Number.isFinite(resultCode) ? resultCode : undefined,
    resultDesc: r.ResultDesc ? String(r.ResultDesc) : undefined,
  };
}

/** HMAC bound to an order reference; embedded in the callback URL so only PayHero (who we gave the URL) can call it. */
export function signCallbackReference(env: AppEnv, reference: string) {
  return createHmac("sha256", requireStr(env, "PAYHERO_WEBHOOK_SECRET")).update(reference).digest("hex");
}

export function verifyCallbackSignature(env: AppEnv, reference: string, signature: string | null) {
  if (!reference || !signature) return false;
  const expected = Buffer.from(signCallbackReference(env, reference));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
