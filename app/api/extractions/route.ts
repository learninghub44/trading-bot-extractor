import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";

const schema = z.object({ url: z.string().url().max(2048) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "A valid bot URL is required." }, { status: 400 });
  }

  const id = randomUUID();
  const extractorUrl = process.env.EXTRACTOR_URL;

  if (!extractorUrl) {
    return NextResponse.json({
      id,
      status: "QUEUED",
      message: "Extraction service is not configured yet.",
    }, { status: 202 });
  }

  try {
    const response = await fetch(`${extractorUrl.replace(/\/$/, "")}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-job-id": id },
      body: JSON.stringify({ url: parsed.data.url }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => ({ error: "Invalid extractor response." }));
    if (!response.ok) return NextResponse.json({ id, status: "FAILED", ...data }, { status: 502 });

    return NextResponse.json({ id, ...data }, { status: 202 });
  } catch {
    return NextResponse.json({ id, status: "FAILED", error: "Extraction service unavailable." }, { status: 503 });
  }
}
