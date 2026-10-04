import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { PACKAGES } from "@/lib/pricing";
async function handleGET() { return NextResponse.json({ currency: "KES", products: PACKAGES }); }

export const GET = withApi(handleGET);
