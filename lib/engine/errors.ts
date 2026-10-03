export class EngineError extends Error {
  constructor(public code: string, public transient = false, message?: string) {
    super(message ?? code);
    this.name = "EngineError";
  }
}

export function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return new EngineError("SOURCE_TIMEOUT", true);
  return new EngineError("SOURCE_UNREACHABLE", true, error instanceof Error ? error.message : "Unknown error");
}
