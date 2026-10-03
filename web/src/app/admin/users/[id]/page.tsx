"use client";

// Admin user detail: identities, profile, bills (+insights manage), interactions, send message.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/client/api";

interface Detail {
  user: { id: string; displayName: string | null; isBlocked: boolean; createdAt: number; lastSeenAt: number | null };
  identities: { channel: string; externalId: string; username: string | null; lastSeenAt: number | null }[];
  profile: { household: Record<string, unknown>; behaviour: Record<string, unknown>; goals: { text: string }[] } | null;
  bills: {
    id: string;
    billId: string;
    utilityType: string;
    amount: number;
    term: string | null;
    createdAt: number;
    hasSuggestions: boolean;
    suggestions: { intro: string; tips: string[] } | null;
  }[];
  messages: { id: number; channel: string; role: string; content: string; createdAt: number }[];
}

const TABS = ["bills", "messages", "profile"] as const;
type Tab = (typeof TABS)[number];

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("bills");
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Detail>(`/api/admin/users/${id}`).then(setD).catch(() => setStatus("بارگذاری ناموفق"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send() {
    if (!msg.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await api<{ delivered: string[] }>(`/api/admin/users/${id}/send`, { method: "POST", body: { text: msg } });
      setStatus(`ارسال شد به: ${r.delivered.join(", ")}`);
      setMsg("");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function regenInsights(billId: string, doSend: boolean) {
    setBusy(true);
    setStatus(null);
    try {
      await api(`/api/admin/bills/${billId}/insights`, { method: "POST", body: { send: doSend } });
      setStatus(doSend ? "پیشنهادها تولید و برای کاربر ارسال شد" : "پیشنهادها دوباره تولید شد");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    if (!d) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${id}`, { method: "POST", body: { isBlocked: !d.user.isBlocked } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <div className="p-8 text-center text-sm">{status ?? "…در حال بارگذاری"}</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-black">{d.user.displayName || d.identities[0]?.username || d.user.id.slice(0, 8)}</h1>
          <p className="text-xs text-[var(--muted-foreground)]">
            {d.identities.map((i) => `${i.channel === "bale" ? "بله" : "تلگرام"} (${i.externalId})`).join(" + ")}
          </p>
        </div>
        <button
          onClick={toggleBlock}
          disabled={busy}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${
            d.user.isBlocked ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "border border-[var(--warning)] text-[var(--warning)]"
          }`}
        >
          {d.user.isBlocked ? "رفع مسدودی" : "مسدودسازی"}
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-2 text-sm font-bold">ارسال پیام دستی (ناج)</h2>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={2}
          placeholder="متن پیام…"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm outline-none focus:border-[var(--primary)]"
        />
        <button
          onClick={send}
          disabled={busy}
          className="mt-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          ارسال به کانال کاربر
        </button>
        {status && <p className="mt-2 text-xs text-[var(--muted-foreground)]">{status}</p>}
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${
              tab === t ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--card)] text-[var(--muted-foreground)]"
            }`}
          >
            {t === "bills" ? `قبض‌ها (${d.bills.length.toLocaleString("fa-IR")})` : t === "messages" ? "تعامل‌ها" : "پروفایل"}
          </button>
        ))}
      </div>

      {tab === "bills" && (
        <div className="space-y-3">
          {d.bills.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">قبضی ثبت نشده.</p>}
          {d.bills.map((b) => (
            <div key={b.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  {b.utilityType} · دوره {b.term ?? "—"} · {(b.amount / 10).toLocaleString("fa-IR")} تومان
                </span>
                <span className="flex gap-2">
                  <button
                    onClick={() => regenInsights(b.id, false)}
                    disabled={busy}
                    className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs"
                  >
                    تولید دوبارهٔ پیشنهادها
                  </button>
                  <button
                    onClick={() => regenInsights(b.id, true)}
                    disabled={busy}
                    className="rounded-lg bg-[var(--primary)] px-3 py-1 text-xs font-bold text-[var(--primary-foreground)]"
                  >
                    تولید و ارسال
                  </button>
                </span>
              </div>
              {b.suggestions && (
                <p className="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">
                  {b.suggestions.intro} — {b.suggestions.tips.length} نکته
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "messages" && (
        <div className="space-y-2">
          {d.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-3 text-sm ${
                m.role === "user" ? "border-[var(--border)] bg-[var(--card)]" : "bg-[var(--background)]"
              }`}
            >
              <div className="mb-1 text-xs text-[var(--muted-foreground)]">
                {m.role === "user" ? "کاربر" : m.role === "admin" ? "مدیر" : "ربات"} · {m.channel} ·{" "}
                {new Date(m.createdAt).toLocaleString("fa-IR")}
              </div>
              {m.content}
            </div>
          ))}
          {d.messages.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">تعاملی ثبت نشده.</p>}
        </div>
      )}

      {tab === "profile" && (
        <pre className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-xs leading-6" dir="ltr">
          {JSON.stringify({ household: d.profile?.household, behaviour: d.profile?.behaviour, goals: d.profile?.goals }, null, 2)}
        </pre>
      )}
    </div>
  );
}
