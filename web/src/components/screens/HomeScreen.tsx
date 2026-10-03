"use client";

// Home screen (Stitch 01-home): greeting + avatar, streak/XP slot (v3-ready,
// hidden at zero), latest-bill card, insights preview, quick actions.

import { useEffect, useState } from "react";
import { Zap, MessageCircle, Receipt, GraduationCap, ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StreakFlame } from "@/components/kit/StreakFlame";
import { EmptyState } from "@/components/kit/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useUserNav } from "@/lib/nav/UserNav";
import { toFaDigits } from "@/components/kit/logic";
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

export default function HomeScreen() {
  const { go } = useUserNav();
  const [name, setName] = useState<string | null>(null);
  const [bills, setBills] = useState<BillJson[] | null>(null);

  useEffect(() => {
    api<{ user: { displayName: string | null } }>("/api/me")
      .then((d) => setName(d.user.displayName))
      .catch(() => {});
    api<{ bills: BillJson[] }>("/api/bills")
      .then((d) => setBills(d.bills))
      .catch(() => setBills([]));
  }, []);

  const latest = bills?.[0];
  const firstName = (name ?? "دوست من").split(" ")[0];

  return (
    <AppShell>
      <div className="space-y-4">
        {/* Greeting row */}
        <div className="flex items-center gap-3 pt-2">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-lg font-black text-[var(--primary-foreground)]">
            {firstName.slice(0, 1)}
          </div>
          <div className="flex-1">
            <p className="text-xs text-[var(--muted-foreground)]">سلام</p>
            <h1 className="text-xl font-black leading-tight">{firstName} 👋</h1>
          </div>
          {/* v3 slot: hidden until the gamification core ships real numbers */}
          <StreakFlame days={0} />
        </div>

        {bills === null ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              …در حال بارگذاری
            </CardContent>
          </Card>
        ) : latest ? (
          <>
            {/* Latest bill */}
            <Card className="border-[var(--primary)]/20 bg-gradient-to-b from-[var(--secondary)] to-[var(--card)]">
              <CardContent className="space-y-2 px-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--muted-foreground)]">
                    <Zap className="size-3.5 text-[var(--primary)]" aria-hidden />
                    آخرین قبض · {latest.utilityLabel}
                  </span>
                  {latest.term && (
                    <Badge variant="secondary" className="rounded-full text-[10px]">
                      دوره {latest.term}
                    </Badge>
                  )}
                </div>
                <div className="text-3xl font-black">{latest.amountLabel}</div>
                {latest.consumption != null && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    مصرف دوره: {toFaDigits(latest.consumption)} کیلووات‌ساعت
                  </p>
                )}
                <Button
                  variant="secondary"
                  className="h-9 w-full rounded-full text-xs font-bold"
                  onClick={() => go("bills")}
                >
                  مشاهدهٔ قبض‌ها
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
              </CardContent>
            </Card>

            {/* Insights preview */}
            <Card>
              <CardContent className="space-y-2 px-4">
                <h2 className="font-black">💡 پیشنهادهای هوشمند</h2>
                {latest.suggestions ? (
                  <div className="space-y-2 text-sm leading-6">
                    <p>{latest.suggestions.intro}</p>
                    <ul className="space-y-1.5">
                      {latest.suggestions.tips.slice(0, 3).map((t, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-1.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-[10px] font-black text-[var(--primary-foreground)]">
                            {toFaDigits(i + 1)}
                          </span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    برای این قبض هنوز پیشنهادی ثبت نشده.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <EmptyState
            icon="📄"
            title="اولین قبضت را بفرست!"
            desc="عکس قبض برق یا گاز را بفرست تا استعلام و تحلیلش کنم."
          >
            <Button className="h-12 w-full rounded-full text-base font-black" onClick={() => go("bills")}>
              ثبت اولین قبض
            </Button>
          </EmptyState>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => go("bills")}
            className="flex flex-col items-center gap-2 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm transition-transform active:scale-95"
          >
            <Receipt className="size-6 text-[var(--primary)]" aria-hidden />
            <span className="text-xs font-bold">قبض جدید</span>
          </button>
          <button
            type="button"
            onClick={() => go("chat")}
            className="flex flex-col items-center gap-2 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm transition-transform active:scale-95"
          >
            <MessageCircle className="size-6 text-[var(--primary)]" aria-hidden />
            <span className="text-xs font-bold">گفتگو</span>
          </button>
          <div className="relative flex flex-col items-center gap-2 rounded-3xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 p-4 opacity-70">
            <GraduationCap className="size-6 text-[var(--muted-foreground)]" aria-hidden />
            <span className="text-xs font-bold text-[var(--muted-foreground)]">درس‌ها</span>
            <Badge className="absolute -top-2 rounded-full bg-[var(--streak)] px-2 text-[9px] text-[var(--streak-foreground)]">
              به‌زودی
            </Badge>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
