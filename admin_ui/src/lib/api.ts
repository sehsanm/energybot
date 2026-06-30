import { getCsrf, setCsrf } from "./csrf";

const BASE = "/api/admin";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };
  const csrf = getCsrf();
  if (csrf && init.method && init.method !== "GET") headers["x-csrf"] = csrf;
  const r = await fetch(`${BASE}${path}`, { credentials: "include", ...init, headers });
  const csrfFromResp = r.headers.get("x-csrf");
  if (csrfFromResp) setCsrf(csrfFromResp);
  if (r.status === 401) { if (typeof window !== "undefined") window.location.href = "/admin/login"; throw new Error("unauth"); }
  if (!r.ok) throw new Error(`api ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) => request("/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request<{ id: string; email: string; role: string }>("/me"),
  logout: () => request("/logout", { method: "POST" }),
  listUsers: () => request<{ users: any[] }>("/users"),
  getUser: (id: string) => request<{ user: any; profile: any; sessions: any[] }>(`/users/${id}`),
  getUserBills: (id: string) => request<{ bills: any[] }>(`/users/${id}/bills`),
  regenerateBillSuggestions: (userId: string, billId: string) =>
    request<{ suggestions: any }>(`/users/${userId}/bills/${billId}/suggestions/regenerate`, { method: "POST" }),
  sendBillSuggestions: (userId: string, billId: string) =>
    request<{ ok: boolean }>(`/users/${userId}/bills/${billId}/suggestions/send`, { method: "POST" }),
  listChats: () => request<{ sessions: any[] }>("/chats"),
  getChat: (id: string) => request<{ messages: any[] }>(`/chats/${id}`),
  listArticles: () => request<{ articles: any[] }>("/kb/articles"),
  getArticle: (id: string) => request<any>(`/kb/articles/${id}`),
  createArticle: (data: any) => request<{ id: string }>("/kb/articles", { method: "POST", body: JSON.stringify(data) }),
  updateArticle: (id: string, data: any) => request(`/kb/articles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  publishArticle: (id: string) => request(`/kb/articles/${id}/publish`, { method: "POST" }),
  deleteArticle: (id: string) => request(`/kb/articles/${id}`, { method: "DELETE" }),
  searchKB: (q: string, top_k = 5, category?: string) => request<{ hits: any[] }>("/kb/search", { method: "POST", body: JSON.stringify({ query: q, top_k, category }) }),
  listPrompts: (key?: string) => request<{ prompts: any[] }>(`/prompts${key ? `?key=${encodeURIComponent(key)}` : ""}`),
  createPrompt: (d: any) => request<{ id: string; version: number }>("/prompts", { method: "POST", body: JSON.stringify(d) }),
  activatePrompt: (id: string) => request(`/prompts/${id}/activate`, { method: "POST" }),
  listModels: () => request<{ models: any[] }>("/models"),
  createModel: (d: any) => request<{ id: string }>("/models", { method: "POST", body: JSON.stringify(d) }),
  activateModel: (id: string) => request(`/models/${id}/activate`, { method: "POST" }),
  listIncentiveParams: () => request<{ params: any[] }>("/incentives/params"),
  createIncentiveParam: (d: any) => request<{ id: string }>("/incentives/params", { method: "POST", body: JSON.stringify(d) }),
  updateIncentiveParam: (id: string, d: any) => request(`/incentives/params/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  deleteIncentiveParam: (id: string) => request(`/incentives/params/${id}`, { method: "DELETE" }),
  listCityZones: () => request<{ cities: any[] }>("/incentives/cities"),
  createCityZone: (d: any) => request<{ id: string }>("/incentives/cities", { method: "POST", body: JSON.stringify(d) }),
  updateCityZone: (id: string, d: any) => request(`/incentives/cities/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  deleteCityZone: (id: string) => request(`/incentives/cities/${id}`, { method: "DELETE" }),
  auditLog: () => request<{ entries: any[] }>("/audit-log"),
  dashboard: () => request<any>("/stats/dashboard"),
};
