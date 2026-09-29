import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "./server";

let client: S3Client | undefined;

function storage() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: requireEnv("R2_ENDPOINT"),
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

export async function putPrivateObject(key: string, body: Uint8Array | Buffer, contentType: string) {
  await storage().send(new PutObjectCommand({
    Bucket: requireEnv("R2_BUCKET"),
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "private, max-age=0, no-store",
  }));
}

export async function signedDownload(key: string, filename: string) {
  return getSignedUrl(storage(), new GetObjectCommand({
    Bucket: requireEnv("R2_BUCKET"),
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, "_")}"`,
    ResponseContentType: "application/xml",
  }), { expiresIn: Number(process.env.DOWNLOAD_TTL_SECONDS || 900) });
}
