"use client";

// Dashboard: latest bill headline + insights preview + quick links.

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, Card, PrimaryButton } from "@/components/AppShell";
import { SessionGate } from "@/components/SessionGate";
import { api } from "@/lib/client/api";

interface BillJson {
  id: string;
  utilityLabel: string;
  amountLabel: string;
  term: string | null;
  consumption: number | null;
  suggestions: { intro: string; tips: string[] } | null;
  createdAt: number;
}

function Dashboard() {
  const [bills, setBills] = useState<BillJson[] | null>(null);
  useEffect(() => {
    api<{ bills: BillJson[] }>("/api/bills")
      .then((d) => setBills(d.bills))
      .catch(() => setBills([]));
  }, []);
  const latest = bills?.[0];

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black">دستیار انرژی</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">قبضت را بفرست، تحلیل و پیشنهاد صرفه‌جویی بگیر</p>
        </div>

        {bills === null ? (
          <Card>…در حال بارگذاری</Card>
        ) : latest ? (
          <>
            <Card>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)]">آخرین قبض · {latest.utilityLabel}</span>
                {latest.term && <span className="text-xs text-[var(--muted)]">دوره {latest.term}</span>}
              </div>
              <div className="mt-2 text-2xl font-black">{latest.amountLabel}</div>
              {latest.consumption != null && (
                <div className="mt-1 text-sm text-[var(--muted)]">
                  مصرف دوره: {latest.consumption.toLocaleString("fa-IR")} کیلووات‌ساعت
                </div>
              )}
            </Card>
            <Card>
              <h2 className="mb-2 font-bold">💡 پیشنهادها</h2>
              {latest.suggestions ? (
                <div className="space-y-2 text-sm leading-6">
                  <p>{latest.suggestions.intro}</p>
                  <ul className="list-inside list-disc space-y-1">
                    {latest.suggestions.tips.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">برای این قبض هنوز پیشنهادی ثبت نشده.</p>
              )}
            </Card>
          </>
        ) : (
          <Card className="space-y-3 text-center">
            <div className="text-4xl">📄</div>
            <p className="text-sm leading-7 text-[var(--muted)]">
              هنوز قبضی ثبت نکرده‌ای. عکس قبض برق یا گاز را بفرست تا استعلام و تحلیلش کنم.
            </p>
            <Link href="/bills">
              <PrimaryButton>ثبت اولین قبض</PrimaryButton>
            </Link>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link href="/bills" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center text-sm font-bold">
            📄 قبض‌های من
          </Link>
          <Link href="/profile" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center text-sm font-bold">
            👤 پروفایل
          </Link>
        </div>
        <p className="pt-2 text-center text-xs text-[var(--muted)]">
          گفتگوی هوشمند و درس‌های کوتاه صرفه‌جویی به‌زودی می‌آید 🚀
        </p>
      </div>
    </AppShell>
  );
}

export default function Home() {
  return <SessionGate>{() => <Dashboard />}</SessionGate>;
}
