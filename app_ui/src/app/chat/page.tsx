"use client";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getHistory, streamChat, type ChatMsg } from "@/lib/api";

type Bubble =
  | { kind: "text"; role: "user" | "assistant"; content: string }
  | { kind: "media"; url: string; mediaType: string; caption: string | null }
  | { kind: "error"; content: string };

export default function ChatPage() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [oldestId, setOldestId] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHistory().then((msgs: ChatMsg[]) => {
      setBubbles(msgs.map((m) => ({ kind: "text", role: m.role, content: m.content })));
      if (msgs.length) setOldestId(msgs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [bubbles, status]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setBubbles((b) => [...b, { kind: "text", role: "user", content: text }]);
    await streamChat(text, {
      onStatus: (t) => setStatus(t),
      onMedia: (m) => setBubbles((b) => [...b, { kind: "media", url: m.url, mediaType: m.media_type, caption: m.caption }]),
      onChunk: (t) => setBubbles((b) => {
        setStatus(null);
        const last = b[b.length - 1];
        if (last && last.kind === "text" && last.role === "assistant") {
          return [...b.slice(0, -1), { ...last, content: last.content + t }];
        }
        return [...b, { kind: "text", role: "assistant", content: t }];
      }),
      onDone: () => { setStatus(null); setBusy(false); },
      onError: (t) => { setStatus(null); setBusy(false); setBubbles((b) => [...b, { kind: "error", content: t }]); },
    });
  }

  async function loadOlder() {
    if (oldestId == null) return;
    const older = await getHistory(oldestId);
    if (!older.length) { setOldestId(null); return; }
    setBubbles((b) => [...older.map((m) => ({ kind: "text", role: m.role, content: m.content } as Bubble)), ...b]);
    setOldestId(older[0].id);
  }

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-8rem)]" dir="rtl">
        {oldestId != null && (
          <button onClick={loadOlder} className="mx-auto mb-2 text-xs text-muted-foreground hover:text-foreground">
            نمایش پیام‌های قبلی
          </button>
        )}
        <div className="flex-1 overflow-y-auto space-y-3 px-1">
          {bubbles.map((b, i) => {
            if (b.kind === "media") {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg overflow-hidden border">
                    {b.mediaType === "video"
                      ? <video src={b.url} controls className="max-w-full" />
                      : <img src={b.url} alt={b.caption ?? ""} className="max-w-full" />}
                    {b.caption && <div className="p-2 text-sm">{b.caption}</div>}
                  </div>
                </div>
              );
            }
            if (b.kind === "error") {
              return <div key={i} className="text-center text-sm text-red-500">{b.content}</div>;
            }
            const mine = b.role === "user";
            return (
              <div key={i} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {b.content}
                </div>
              </div>
            );
          })}
          {status && <div className="text-center text-xs text-muted-foreground">{status}</div>}
          <div ref={endRef} />
        </div>
        <div className="mt-3 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="پیامت را بنویس…"
            className="flex-1 resize-none rounded-md border px-3 py-2 text-sm"
          />
          <button onClick={send} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
            ارسال
          </button>
        </div>
      </div>
    </AppShell>
  );
}
