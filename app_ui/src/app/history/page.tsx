"use client";
import { useEffect, useState } from "react";
import { Bot, ChevronRight, MessagesSquare, History as HistoryIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { getSessions, getSessionMessages, type SessionRow, type ChatMsg } from "@/lib/api";
import { faNum, faDate } from "@/lib/format";

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);

  useEffect(() => {
    getSessions()
      .then((s) => {
        setSessions(s);
        const q = new URLSearchParams(window.location.search).get("s");
        if (q) setSelected(q);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    getSessionMessages(selected).then(setMessages).catch(() => setMessages([]));
    const u = new URL(window.location.href);
    u.searchParams.set("s", selected);
    window.history.replaceState(null, "", u.toString());
  }, [selected]);

  return (
    <AppShell>
      <div className="flex h-[calc(100dvh-11rem)] flex-col lg:h-[calc(100dvh-8rem)]">
        <header className="mb-3 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">تاریخچهٔ گفتگوها</h1>
          <p className="text-sm text-muted-foreground">گفتگوهای پیشین خود را مرور کن</p>
        </header>

        <div className="flex min-h-0 flex-1 gap-4">
          {/* list */}
          <aside
            className={cn(
              "min-h-0 w-full overflow-y-auto rounded-xl border border-border bg-card p-2 md:w-80 md:shrink-0",
              selected && "hidden md:block"
            )}
          >
            {!loaded ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState
                className="h-full border-0 bg-transparent"
                icon={MessagesSquare}
                title="هنوز گفتگویی نداری"
                description="گفتگوهایت پس از شروع، این‌جا فهرست می‌شوند."
              />
            ) : (
              <ul className="space-y-1">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelected(s.id)}
                      className={cn(
                        "w-full rounded-lg px-3 py-2.5 text-start transition-colors",
                        selected === s.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                      )}
                    >
                      <div className="truncate text-sm font-medium">{s.snippet || "گفتگو"}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {faDate(s.started_at)} · {faNum(s.message_count)} پیام
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* detail */}
          <main
            className={cn(
              "min-h-0 flex-1 flex-col rounded-xl border border-border bg-card",
              selected ? "flex" : "hidden md:flex"
            )}
          >
            {selected && (
              <div className="shrink-0 border-b border-border p-2 md:hidden">
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  <ChevronRight className="h-4 w-4" />
                  بازگشت به فهرست
                </Button>
              </div>
            )}
            {!selected ? (
              <EmptyState
                className="h-full border-0 bg-transparent"
                icon={HistoryIcon}
                title="یک گفتگو را انتخاب کن"
                description="برای مشاهدهٔ پیام‌ها، یکی از گفتگوهای فهرست را باز کن."
              />
            ) : (
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {messages.map((m) => {
                  const mine = m.role === "user";
                  return (
                    <div key={m.id} className={cn("flex items-end gap-2", mine ? "justify-start" : "justify-end")}>
                      {!mine && (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                          <Bot className="h-4 w-4" />
                        </span>
                      )}
                      <div
                        className={cn(
                          "max-w-[78%] whitespace-pre-wrap px-4 py-2.5 text-sm leading-6",
                          mine
                            ? "rounded-2xl rounded-ss-sm bg-primary text-primary-foreground"
                            : "rounded-2xl rounded-es-sm border border-border bg-background text-foreground"
                        )}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </AppShell>
  );
}
