"use client";

// Admin dashboard: headline numbers + channel split + audit tail.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";

interface Stats {
  usersTotal: number;
  usersActive: number;
  billsTotal: number;
  insightsCount: number;
  messages7d: number;
  byChannel: { channel: string; n: number }[];
}

interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: number;
}

function fa(n: number): string {
  return n.toLocaleString("fa-IR");
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    api<Stats>("/api/admin/stats").then(setStats).catch(() => setDenied(true));
    api<{ entries: AuditEntry[] }>("/api/admin/audit").then((d) => setAudit(d.entries)).catch(() => {});
  }, []);

  if (denied) {
    return (
      <div className="p-8 text-center text-sm">
        دسترسی نداری. <Link href="/admin/login" className="font-bold text-[var(--primary)]">ورود مدیر</Link>
      </div>
    );
  }

  const cards: { label: string; value: string }[] = stats
    ? [
        { label: "کاربران", value: fa(stats.usersTotal) },
        { label: "فعال (۲۴س)", value: fa(stats.usersActive) },
        { label: "قبض‌ها", value: fa(stats.billsTotal) },
        { label: "پیشنهادهای تولیدشده", value: fa(stats.insightsCount) },
        { label: "پیام‌ها (۷روز)", value: fa(stats.messages7d) },
      ]
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">داشبورد مدیریت</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/admin/users" className="font-bold text-[var(--primary)]">کاربران</Link>
          <Link href="/admin/kb" className="font-bold text-[var(--primary)]">دانش‌نامه</Link>
          <button
            onClick={() => api("/api/auth/logout", { method: "POST" }).then(() => location.assign("/admin/login"))}
            className="text-[var(--muted-foreground)]"
          >
            خروج
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-2xl font-black">{c.value}</div>
            <div className="mt-1 text-xs text-[var(--muted-foreground)]">{c.label}</div>
          </div>
        ))}
      </div>

      {stats && stats.byChannel.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <span className="font-bold">کانال‌ها: </span>
          {stats.byChannel.map((c) => (
            <span key={c.channel} className="ml-3">
              {c.channel === "bale" ? "بله" : "تلگرام"}: {fa(Number(c.n))}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-2 font-bold">آخرین اقدام‌های مدیران</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">چیزی ثبت نشده است.</p>
        ) : (
          <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
            {audit.slice(0, 10).map((a) => (
              <li key={a.id}>
                {new Date(a.createdAt).toLocaleString("fa-IR")} — {a.action} ({a.entityType})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
