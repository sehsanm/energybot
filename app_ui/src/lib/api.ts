let csrf = "";

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && csrf) headers.set("x-csrf", csrf);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`/api/app${path}`, { ...init, headers, credentials: "same-origin" });
  const c = res.headers.get("x-csrf");
  if (c) csrf = c;
  return res;
}

export async function redeem(t: string) {
  const r = await req("/auth/redeem", { method: "POST", body: JSON.stringify({ t }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function getMe() {
  const r = await req("/me");
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function logout() {
  await req("/auth/logout", { method: "POST" });
}
