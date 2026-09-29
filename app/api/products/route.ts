import { NextResponse } from "next/server";
import { PACKAGES } from "@/lib/pricing";
export async function GET() { return NextResponse.json({ currency: "KES", products: PACKAGES }); }
