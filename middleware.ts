import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes the Supabase session cookie. Never blocks a page: guests have no session, and any failure is ignored. */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (!url || !key || !hasSession) return response;
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => items.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }),
      },
    });
    await supabase.auth.getUser();
  } catch (error) {
    console.error("[middleware] session refresh failed", error);
  }
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"] };
