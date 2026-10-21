"use client";

// Home screen (Stitch 01-home): greeting + avatar, streak/XP/coins strip
// (hidden at zero), latest-bill card, insights preview, quick actions.
// Also the onboarding entry point (spec §6): un-onboarded sessions are taken
// over by /welcome, and a skipped wizard leaves a «کامل کردن پروفایل» card
// here instead of the first-bill empty state until the profile has data.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { copy } from "@/content/copy";
import { shouldRedirectToWelcome } from "@/lib/onboarding/shouldRedirectToWelcome";
import { draftFromProfile, type ProfileLike } from "@/lib/onboarding/steps";

interface BillJson {
  id: string;
  utilityLabel: string;
  amountLabel: string;
  term: string | null;
  consumption: number | null;
  suggestions: { intro: string; tips: string[] } | null;
  createdAt: number;
}

/** The `gamification` block of GET /api/me (lib/courses/apiViews.ts). */
interface GamificationJson {
  xp: number;
  coins: number;
  streak: { current: number; best: number; freezes: number };
  badges: string[];
  lessonsCompleted: number;
}

interface MeJson {
  user: { displayName: string | null };
  onboarded: boolean;
  skipped: boolean;
  // Optional: a payload without it (older server, edge case) must not crash
  // the screen — the strip simply stays hidden.
  gamification?: GamificationJson | null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { go } = useUserNav();
  // null until /api/me answers; a failed fetch leaves it null (render as today).
  const [me, setMe] = useState<MeJson | null>(null);
  const [meFailed, setMeFailed] = useState(false);
  const [bills, setBills] = useState<BillJson[] | null>(null);
  // Only fetched while un-onboarded: it decides welcome card vs first-bill
  // empty state. null (unknown / fetch failed) means "has data", so the
  // first-bill prompt stays the default.
  const [profileEmpty, setProfileEmpty] = useState<boolean | null>(null);
  // replace() must fire once per mount even if the effect re-runs (dev
  // StrictMode, me settling twice) — the ref, not the closure, decides.
  const redirectedRef = useRef(false);

  useEffect(() => {
    api<MeJson>("/api/me").then(setMe).catch(() => setMeFailed(true));
    api<{ bills: BillJson[] }>("/api/bills")
      .then((d) => setBills(d.bills))
      .catch(() => setBills([]));
  }, []);

  // Entry rule (spec §6): an un-onboarded session never lands on /home.
  useEffect(() => {
    if (me === null || redirectedRef.current) return;
    if (!shouldRedirectToWelcome(me)) return;
    redirectedRef.current = true;
    router.replace("/welcome");
  }, [me, router]);

  // The welcome card replaces the first-bill empty state only while the
  // profile carries no wizard data at all (the same freshness rule the
  // wizard uses to pick its start step).
  useEffect(() => {
    if (me === null || me.onboarded !== false) return;
    api<ProfileLike>("/api/profile")
      .then((d) => setProfileEmpty(Object.values(draftFromProfile(d)).every((v) => v === undefined)))
      .catch(() => setProfileEmpty(false));
  }, [me]);

  const latest = bills?.[0];
  const firstName = (me?.user.displayName ?? "دوست من").split(" ")[0];
  const loading = bills === null || (me === null && !meFailed);
  const welcomeCard = me?.onboarded === false && profileEmpty === true && !latest;
  // The gamification strip only exists when there is something to show:
  // /api/me answered with gamification AND at least one counter is nonzero.
  // Fresh accounts keep the bare greeting — no empty chips.
  const stats =
    me?.gamification &&
    (me.gamification.xp > 0 || me.gamification.coins > 0 || me.gamification.streak.current > 0)
      ? me.gamification
      : null;

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
          {/* v3 gamification strip: streak + ⚡xp (StreakFlame hides itself
              when the streak is cold) + 🪙coins. Nothing at all at zero. */}
          {stats && (
            <div className="flex shrink-0 items-center gap-1.5">
              <StreakFlame days={stats.streak.current} xp={stats.xp} />
              {stats.coins > 0 && (
                <span
                  aria-label={copy.home.coinsAria}
                  className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-3 py-1 text-xs font-bold text-[var(--secondary-foreground)]"
                >
                  🪙 {toFaDigits(stats.coins)}
                </span>
              )}
            </div>
          )}
        </div>

        {loading ? (
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
        ) : welcomeCard ? (
          <EmptyState
            icon="📝"
            title={copy.onboardingWizard.homeCard.title}
            desc={copy.onboardingWizard.homeCard.desc}
          >
            <Button
              className="h-12 w-full rounded-full text-base font-black"
              onClick={() => router.replace("/welcome")}
            >
              {copy.onboardingWizard.homeCard.cta}
            </Button>
          </EmptyState>
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
          <button
            type="button"
            onClick={() => go("courses")}
            className="flex flex-col items-center gap-2 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm transition-transform active:scale-95"
          >
            <GraduationCap className="size-6 text-[var(--primary)]" aria-hidden />
            <span className="text-xs font-bold">{copy.home.lessonsTile}</span>
          </button>
        </div>
      </div>
    </AppShell>
  );
}
