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
