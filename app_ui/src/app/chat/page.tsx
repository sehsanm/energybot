"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, SendHorizontal, ChevronUp, MessageSquarePlus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getHistory, streamChat, type ChatMsg } from "@/lib/api";

type Bubble =
  | { kind: "text"; role: "user" | "assistant"; content: string }
  | { kind: "media"; url: string; mediaType: string; caption: string | null }
  | { kind: "error"; content: string };

function BotAvatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
      <Bot className="h-4 w-4" />
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-pulse-soft"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

export default function ChatPage() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [oldestId, setOldestId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHistory()
      .then((msgs: ChatMsg[]) => {
        setBubbles(msgs.map((m) => ({ kind: "text", role: m.role, content: m.content })));
        if (msgs.length) setOldestId(msgs[0].id);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles, status]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setBubbles((b) => [...b, { kind: "text", role: "user", content: text }]);
    await streamChat(text, {
      onStatus: (t) => setStatus(t),
      onMedia: (m) =>
        setBubbles((b) => [...b, { kind: "media", url: m.url, mediaType: m.media_type, caption: m.caption }]),
      onChunk: (t) =>
        setBubbles((b) => {
          setStatus(null);
          const last = b[b.length - 1];
          if (last && last.kind === "text" && last.role === "assistant") {
            return [...b.slice(0, -1), { ...last, content: last.content + t }];
          }
          return [...b, { kind: "text", role: "assistant", content: t }];
        }),
      onDone: () => {
        setStatus(null);
        setBusy(false);
      },
      onError: (t) => {
        setStatus(null);
        setBusy(false);
        setBubbles((b) => [...b, { kind: "error", content: t }]);
      },
    });
  }

  async function loadOlder() {
    if (oldestId == null) return;
    const older = await getHistory(oldestId);
    if (!older.length) {
      setOldestId(null);
      return;
    }
    setBubbles((b) => [
      ...older.map((m) => ({ kind: "text", role: m.role, content: m.content } as Bubble)),
      ...b,
    ]);
    setOldestId(older[0].id);
  }

  const empty = loaded && bubbles.length === 0;

  return (
    <AppShell>
      <div className="flex h-[calc(100dvh-11rem)] flex-col lg:h-[calc(100dvh-8rem)]">
        <header className="mb-3 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">گفتگو</h1>
          <p className="text-sm text-muted-foreground">سؤالت دربارهٔ مصرف، قبض و صرفه‌جویی انرژی را بپرس</p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {oldestId != null && (
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={loadOlder} className="text-muted-foreground">
                  <ChevronUp className="h-4 w-4" />
                  نمایش پیام‌های قبلی
                </Button>
              </div>
            )}

            {empty && (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <MessageSquarePlus className="h-7 w-7" />
                </span>
                <div>
                  <h3 className="text-base font-semibold">گفتگو را شروع کن</h3>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    مثلاً بپرس «چطور قبض برقم را کم کنم؟»
                  </p>
                </div>
              </div>
            )}

            {bubbles.map((b, i) => {
              if (b.kind === "media") {
                return (
                  <div key={i} className="flex items-end justify-end gap-2">
                    <BotAvatar />
                    <div className="max-w-[78%] overflow-hidden rounded-2xl rounded-es-sm border border-border bg-background">
                      {b.mediaType === "video" ? (
                        <video src={b.url} controls className="max-w-full" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.url} alt={b.caption ?? "تصویر"} className="max-w-full" />
                      )}
                      {b.caption && <div className="p-2.5 text-sm">{b.caption}</div>}
                    </div>
                  </div>
                );
              }
              if (b.kind === "error") {
                return (
                  <div key={i} className="flex justify-center">
                    <div className="rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
                      {b.content}
                    </div>
                  </div>
                );
              }
              const mine = b.role === "user";
              return (
                <div key={i} className={cn("flex items-end gap-2", mine ? "justify-start" : "justify-end")}>
                  {!mine && <BotAvatar />}
                  <div
                    className={cn(
                      "max-w-[78%] whitespace-pre-wrap px-4 py-2.5 text-sm leading-6",
                      mine
                        ? "rounded-2xl rounded-ss-sm bg-primary text-primary-foreground"
                        : "rounded-2xl rounded-es-sm border border-border bg-background text-foreground"
                    )}
                  >
                    {b.content}
                  </div>
                </div>
              );
            })}

            {status && (
              <div className="flex items-end justify-end gap-2">
                <BotAvatar />
                <div className="flex items-center gap-2 rounded-2xl rounded-es-sm border border-border bg-background px-4 py-2.5 text-sm text-muted-foreground">
                  <span>{status}</span>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="پیامت را بنویس…"
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              <Button
                onClick={send}
                disabled={busy || !input.trim()}
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                aria-label="ارسال پیام"
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
