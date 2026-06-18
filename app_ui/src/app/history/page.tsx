"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getSessions, getSessionMessages, type SessionRow, type ChatMsg } from "@/lib/api";

const faDate = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);

  useEffect(() => {
    getSessions().then((s) => {
      setSessions(s);
      const q = new URLSearchParams(window.location.search).get("s");
      if (q) setSelected(q);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    getSessionMessages(selected).then(setMessages).catch(() => setMessages([]));
    const u = new URL(window.location.href);
    u.searchParams.set("s", selected);
    window.history.replaceState(null, "", u.toString());
  }, [selected]);

  return (
    <AppShell>
      <div dir="rtl" className="flex gap-4 h-[calc(100vh-8rem)]">
        <aside className={`${selected ? "hidden md:block" : "block"} w-full md:w-72 shrink-0 overflow-y-auto border-s pe-2`}>
          <h1 className="mb-2 text-lg font-semibold">تاریخچه</h1>
          {sessions.length === 0 && <p className="text-sm text-muted-foreground">هنوز گفتگویی نداری.</p>}
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button onClick={() => setSelected(s.id)}
                  className={`w-full rounded-md px-3 py-2 text-right text-sm hover:bg-muted ${selected === s.id ? "bg-muted" : ""}`}>
                  <div className="truncate">{s.snippet || "گفتگو"}</div>
                  <div className="text-xs text-muted-foreground">{faDate(s.started_at)} · {s.message_count} پیام</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className={`${selected ? "block" : "hidden md:block"} flex-1 overflow-y-auto`}>
          {selected && (
            <button onClick={() => setSelected(null)} className="mb-2 text-sm text-muted-foreground hover:text-foreground md:hidden">‹ بازگشت</button>
          )}
          {!selected ? (
            <p className="hidden md:block text-sm text-muted-foreground">یک گفتگو را انتخاب کن.</p>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const mine = m.role === "user";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.content}</div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
