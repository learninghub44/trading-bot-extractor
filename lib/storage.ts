import { createHmac, timingSafeEqual } from "crypto";
import { bucket, envNum, requireStr, type AppEnv } from "./env";

export async function putPrivateObject(env: AppEnv, key: string, body: Uint8Array, contentType: string) {
  await bucket(env).put(key, body, { httpMetadata: { contentType, cacheControl: "private, max-age=0, no-store" } });
}

export async function getPrivateObject(env: AppEnv, key: string) {
  return bucket(env).get(key);
}

const b64u = (s: string) => Buffer.from(s).toString("base64url");

function sign(env: AppEnv, payload: string) {
  return createHmac("sha256", requireStr(env, "DOWNLOAD_SIGNING_SECRET")).update(payload).digest("base64url");
}

/** Short-lived signed path served by /api/files/[token]; replaces S3 presigned URLs (no S3 creds needed on Workers). */
export function signedDownloadPath(env: AppEnv, key: string, filename: string, contentType = "application/xml") {
  const ttl = envNum(env, "DOWNLOAD_TTL_SECONDS", 900);
  const payload = b64u(JSON.stringify({ k: key, f: filename, t: contentType, e: Math.floor(Date.now() / 1000) + ttl }));
  return { path: `/api/files/${payload}.${sign(env, payload)}`, expiresIn: ttl };
}

export function verifyDownloadToken(env: AppEnv, token: string): { key: string; filename: string; contentType: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(env, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { k: string; f: string; t: string; e: number };
    if (!data.k || data.e < Date.now() / 1000) return null;
    return { key: data.k, filename: data.f || "download", contentType: data.t || "application/octet-stream" };
  } catch {
    return null;
  }
}
