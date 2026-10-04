import { runtime } from "@/lib/env";
import { withApi } from "@/lib/api";
import { getPrivateObject, verifyDownloadToken } from "@/lib/storage";

async function handleGET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { env } = runtime();
  const grant = verifyDownloadToken(env, token);
  if (!grant) return new Response("Link expired or invalid.", { status: 403 });
  const object = await getPrivateObject(env, grant.key);
  if (!object) return new Response("Not found.", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": grant.contentType,
      "content-disposition": `attachment; filename="${grant.filename.replace(/["\\\r\n]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const GET = withApi(handleGET);
