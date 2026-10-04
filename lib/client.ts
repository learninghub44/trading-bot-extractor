export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/** fetch + JSON that never throws and never trusts the body to be JSON. */
export async function callApi<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: T | null = null;
    try { data = text ? (JSON.parse(text) as T) : null; } catch { /* not JSON */ }
    const message = (data as { error?: string } | null)?.error;
    if (res.ok) return { ok: true, status: res.status, data };
    return {
      ok: false, status: res.status, data,
      error: message || (res.status >= 500 ? `Our server had a problem (error ${res.status}). Please try again in a moment.` : `The request was rejected (error ${res.status}).`),
    };
  } catch {
    return { ok: false, status: 0, data: null, error: "Can't reach the server. Check your internet connection and try again." };
  }
}

export const postJson = <T = Record<string, unknown>>(url: string, body: unknown) =>
  callApi<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
