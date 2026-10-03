"use client";

// Client-side API helper: CSRF double-submit header + typed JSON fetch.

const CSRF_KEY = "energybot_csrf";

export function saveCsrf(token: string): void {
  try {
    localStorage.setItem(CSRF_KEY, token);
  } catch {
    /* private mode */
  }
}

export function csrfHeader(): Record<string, string> {
  try {
    const t = localStorage.getItem(CSRF_KEY);
    return t ? { "x-csrf": t } : {};
  } catch {
    return {};
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...csrfHeader() };
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, { method: opts.method ?? "GET", headers, body });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string; csrf?: string };
  if (!r.ok) {
    const err = new Error(data?.error ?? `http ${r.status}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  if (typeof data?.csrf === "string") saveCsrf(data.csrf);
  return data;
}
