"use client";

// Chat screen: assistant grounded in the KB + user context.

import { useEffect, useRef, useState } from "react";
import { AppShell, Card } from "@/components/AppShell";
import { api } from "@/lib/client/api";

interface Msg {
  role: string;
  content: string;
  createdAt: number;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ messages: Msg[] }>("/api/chat")
      .then((d) => setMessages(d.messages))
      .catch(() => setMessages([]));
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...(m ?? []), { role: "user", content: t, createdAt: Date.now() }]);
    setText("");
    try {
      const r = await api<{ reply: string }>("/api/chat", { method: "POST", body: { text: t } });
      setMessages((m) => [...(m ?? []), { role: "assistant", content: r.reply, createdAt: Date.now() }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100dvh-8.5rem)] flex-col gap-3">
        <h1 className="text-xl font-black">گفتگو 💬</h1>
        <Card className="flex-1 overflow-y-auto">
          {messages === null ? (
            <p className="text-sm text-[var(--muted)]">…در حال بارگذاری</p>
          ) : messages.length === 0 ? (
            <div className="space-y-2 text-sm leading-7 text-[var(--muted)]">
              <p>سلام! 👋 دربارهٔ صرفه‌جویی برق و گاز هرچه می‌دانی بپرس.</p>
              <p>مثلاً: «ساعت اوج مصرف چه زمانی‌هاست؟» یا «چطور قبض گازم رو کم کنم؟»</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "mr-auto max-w-[85%] rounded-2xl bg-[var(--accent)] px-3 py-2 text-sm text-[var(--accent-fg)]"
                      : "ml-auto max-w-[85%] rounded-2xl bg-[var(--bg)] px-3 py-2 text-sm leading-6"
                  }
                >
                  {m.content}
                </div>
              ))}
              {busy && <div className="ml-auto animate-pulse text-xs text-[var(--muted)]">…در حال نوشتن</div>}
              <div ref={bottomRef} />
            </div>
          )}
        </Card>
        {error && <p className="text-xs text-[var(--warning)]">{error}</p>}
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="سؤالت را بنویس…"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50"
          >
            ارسال
          </button>
        </div>
      </div>
    </AppShell>
  );
}
