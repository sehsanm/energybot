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

export type ChatMsg = { id: number; role: "user" | "assistant"; content: string; created_at: string };

export async function getHistory(before?: number): Promise<ChatMsg[]> {
  const qs = before ? `?before=${before}` : "";
  const r = await req(`/chat/history${qs}`);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).messages;
}

export type StreamHandlers = {
  onStatus?: (t: string) => void;
  onMedia?: (m: { attachment_id: string; media_type: string; url: string; caption: string | null }) => void;
  onChunk?: (t: string) => void;
  onDone?: (messageId: number | null) => void;
  onError?: (t: string) => void;
};

export async function streamChat(text: string, h: StreamHandlers): Promise<void> {
  const headers = new Headers({ "content-type": "application/json" });
  if (csrf) headers.set("x-csrf", csrf);
  const res = await fetch("/api/app/chat", {
    method: "POST", headers, credentials: "same-origin", body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) { h.onError?.("خطا در ارتباط با سرور"); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = /^event: (.*)$/m.exec(frame)?.[1];
        const dataLine = /^data: (.*)$/m.exec(frame)?.[1];
        if (!ev || dataLine === undefined) continue;
        const data = JSON.parse(dataLine);
        if (ev === "status") h.onStatus?.(data.text);
        else if (ev === "media") h.onMedia?.(data);
        else if (ev === "chunk") h.onChunk?.(data.text);
        else if (ev === "done") h.onDone?.(data.message_id ?? null);
        else if (ev === "error") h.onError?.(data.text);
      }
    }
  } catch {
    h.onError?.("ارتباط قطع شد");
  }
}

export type Subscription = { id: string; utility_type: string; bill_id: string; label: string | null };
export type BillRow = {
  id: string; utility_type: string; amount: number; term: string | null;
  consumption: number | null; due_date: string | null; status: string; inquired_at: string;
};

export async function getBills(): Promise<{ subscriptions: Subscription[]; bills: BillRow[] }> {
  const r = await req("/bills");
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function inquireBill(billId: string): Promise<{ ok: boolean; summary: string; bill_db_id: string | null; error: string | null }> {
  const r = await req("/bills/inquire", { method: "POST", body: JSON.stringify({ bill_id: billId }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function payBill(billDbId: string): Promise<string> {
  const r = await req(`/bills/${billDbId}/pay`, { method: "POST" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).url;
}

export type ProfileField = { key: string; label: string; options: string[] | null; path: string };
export type ProfileData = {
  household: Record<string, unknown>; behaviour: Record<string, unknown>;
  goals: string[]; commitments: string[]; completeness_score: number; fields: ProfileField[];
};

export async function getProfile(): Promise<ProfileData> {
  const r = await req("/profile");
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function patchProfile(path: string, value: string): Promise<ProfileData> {
  const r = await req("/profile", { method: "PATCH", body: JSON.stringify({ path, value }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function addProfileItem(section: "goals" | "commitments", text: string): Promise<ProfileData> {
  const r = await req(`/profile/${section}`, { method: "POST", body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function removeProfileItem(section: "goals" | "commitments", index: number): Promise<ProfileData> {
  const r = await req(`/profile/${section}/${index}`, { method: "DELETE" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export type SessionRow = { id: string; started_at: string; ended_at: string | null; message_count: number; snippet: string };

export async function getSessions(): Promise<SessionRow[]> {
  const r = await req("/chat/sessions");
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).sessions;
}
export async function getSessionMessages(id: string): Promise<ChatMsg[]> {
  const r = await req(`/chat/sessions/${id}`);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).messages;
}
