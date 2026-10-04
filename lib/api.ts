import { NextResponse } from "next/server";
import { ConfigError } from "./env";

/** Every API route returns JSON, even when something throws — never an empty 500 body. */
export function withApi<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error("[config]", error.message);
        return NextResponse.json(
          { error: "Payments aren't switched on yet. Please try again shortly.", code: "NOT_CONFIGURED" },
          { status: 503 },
        );
      }
      console.error("[api]", error);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again.", code: "INTERNAL_ERROR" }, { status: 500 });
    }
  };
}
