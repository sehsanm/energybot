"use client";

// Chat screen (Stitch 02-chat): kit bubbles, typing indicator, pill input.

import { useEffect, useRef, useState } from "react";
import { SendHorizonal, Zap } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ScreenHeader } from "@/components/kit/ScreenHeader";
import { MessageBubble } from "@/components/kit/MessageBubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";

interface Msg {
  role: string;
  content: string;
  createdAt: number;
}

const SUGGESTIONS = ["ساعت اوج مصرف چه زمانی است؟", "چطور قبض گازم را کم کنم؟"];

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
  }, [messages, busy]);

  async function send(t?: string) {
    const val = (t ?? text).trim();
    if (!val || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...(m ?? []), { role: "user", content: val, createdAt: Date.now() }]);
    setText("");
    try {
      const r = await api<{ reply: string }>("/api/chat", { method: "POST", body: { text: val } });
      setMessages((m) => [...(m ?? []), { role: "assistant", content: r.reply, createdAt: Date.now() }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100dvh-10rem)] flex-col gap-3">
        <ScreenHeader
          title="گفتگو"
          subtitle="دستیار متخصص صرفه‌جویی برق و گاز"
          trailing={
            <div className="grid size-9 place-items-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]">
              <Zap className="size-4" aria-hidden />
            </div>
          }
        />

        <div className="flex-1 space-y-3 overflow-y-auto pb-1">
          {messages === null ? (
            <p className="pt-8 text-center text-sm text-[var(--muted-foreground)]">…در حال بارگذاری</p>
          ) : messages.length === 0 ? (
            <div className="space-y-4 pt-6 text-center">
              <div className="text-4xl">👋</div>
              <p className="text-sm font-bold">سلام! هرچه دربارهٔ صرفه‌جویی برق و گاز می‌دانی بپرس.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}
              {busy && (
                <div className="ml-auto flex items-center gap-1 rounded-full bg-[var(--card)] px-3 py-2 shadow-sm">
                  <span className="size-1.5 animate-bounce rounded-full bg-[var(--muted-foreground)] [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-[var(--muted-foreground)] [animation-delay:150ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-[var(--muted-foreground)] [animation-delay:300ms]" />
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="text-xs text-[var(--warning)]">{error}</p>}

        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="سؤالت را بنویس…"
            className="h-12 flex-1 rounded-full bg-[var(--card)] px-5"
          />
          <Button
            className="size-12 shrink-0 rounded-full p-0"
            onClick={() => send()}
            disabled={busy || !text.trim()}
            aria-label="ارسال"
          >
            <SendHorizonal className="size-5 -scale-x-100" aria-hidden />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
