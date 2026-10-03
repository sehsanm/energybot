"use client";

// Admin dashboard (dashboard-mock language): stat cards + charts + audit tail.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Activity, Receipt, Lightbulb, MessageSquare } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ChannelDonut, WeekBars } from "@/components/admin/charts";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/client/api";
import type { StatsResult } from "@/lib/admin/queries";

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
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    api<StatsResult>("/api/admin/stats").then(setStats).catch(() => setDenied(true));
    api<{ entries: AuditEntry[] }>("/api/admin/audit").then((d) => setAudit(d.entries)).catch(() => {});
  }, []);

  if (denied) {
    return (
      <div className="p-8 text-center text-sm">
        دسترسی نداری.{" "}
        <Link href="/admin/login" className="font-bold text-[var(--primary)]">
          ورود مدیر
        </Link>
      </div>
    );
  }

  const cards: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }[] = stats
    ? [
        { label: "کل کاربران", value: fa(stats.usersTotal), icon: Users },
        { label: "فعال (۲۴ ساعت)", value: fa(stats.usersActive), icon: Activity },
        { label: "قبض‌های ثبت‌شده", value: fa(stats.billsTotal), icon: Receipt },
        { label: "پیشنهادهای تولیدشده", value: fa(stats.insightsCount), icon: Lightbulb },
        { label: "پیام‌ها (۷ روز)", value: fa(stats.messages7d), icon: MessageSquare },
      ]
    : [];

  return (
    <AdminShell title="داشبورد مدیریت" crumbs={[{ label: "داشبورد" }]}>
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cards.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="px-4 py-5">
                    <div className="h-7 w-16 animate-pulse rounded bg-[var(--secondary)]" />
                    <div className="mt-2 h-3 w-24 animate-pulse rounded bg-[var(--secondary)]" />
                  </CardContent>
                </Card>
              ))
            : cards.map((c) => (
                <Card key={c.label}>
                  <CardContent className="flex items-center gap-3 px-4 py-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--secondary)] text-[var(--primary)]">
                      <c.icon className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xl font-black" dir="ltr">
                        {c.value}
                      </div>
                      <div className="truncate text-[11px] text-[var(--muted-foreground)]">{c.label}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>

        {/* Charts */}
        {stats && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="space-y-3 px-4 py-4">
                <h2 className="text-sm font-black">تقسیم کانال‌ها</h2>
                {stats.byChannel.length > 0 ? (
                  <ChannelDonut data={stats.byChannel} />
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">هویتی ثبت نشده است.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3 px-4 py-4">
                <h2 className="text-sm font-black">پیام‌های ۷ روز اخیر</h2>
                <WeekBars data={stats.messagesByDay} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Audit tail */}
        <Card>
          <CardContent className="px-4 py-4">
            <h2 className="mb-3 text-sm font-black">آخرین اقدام‌های مدیران</h2>
            {audit.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">چیزی ثبت نشده است.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[var(--muted-foreground)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-2 py-2 text-right font-bold">زمان</th>
                      <th className="px-2 py-2 text-right font-bold">اقدام</th>
                      <th className="px-2 py-2 text-right font-bold">موجودیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.slice(0, 10).map((a) => (
                      <tr key={a.id} className="border-b border-[var(--border)]/50 last:border-0">
                        <td className="whitespace-nowrap px-2 py-2 text-[var(--muted-foreground)]" dir="ltr">
                          {new Date(a.createdAt).toLocaleString("fa-IR")}
                        </td>
                        <td className="px-2 py-2 font-bold">{a.action}</td>
                        <td className="px-2 py-2 text-[var(--muted-foreground)]">
                          {a.entityType} <span dir="ltr">{a.entityId.slice(0, 8)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
