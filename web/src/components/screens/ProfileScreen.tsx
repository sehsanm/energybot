"use client";

// Profile screen (Stitch 04-profile): household form + goals + the «ابزارها»
// editor for behaviour.service_prefs (spec §7 — the wizard's «هر وقت خواستی
// عوضش کنی» promise).

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ScreenHeader } from "@/components/kit/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionCards, toggleValue, type CardOption } from "@/components/onboarding/steps/controls";
import { copy } from "@/content/copy";
import { api } from "@/lib/client/api";
import { TOOLBOX_OPTIONS, draftFromProfile } from "@/lib/onboarding/steps";

const FIELDS: { key: string; label: string; placeholder?: string; numeric?: boolean }[] = [
  { key: "city", label: "شهر", placeholder: "تهران" },
  { key: "home_type", label: "نوع منزل", placeholder: "آپارتمان" },
  { key: "occupants", label: "تعداد ساکنان", placeholder: "۳", numeric: true },
  { key: "area_m2", label: "متراژ (متر مربع)", placeholder: "۱۰۰", numeric: true },
  { key: "heating_type", label: "گرمایش", placeholder: "پکیج گازی" },
  { key: "cooling_type", label: "سرمایش", placeholder: "کولر گازی" },
  { key: "main_concern", label: "اصلی‌ترین دغدغه", placeholder: "هزینهٔ برق" },
];

export default function ProfileScreen() {
  const t = copy.onboardingWizard.profileToolbox;
  const toolboxEmojis = copy.onboardingWizard.toolbox.emojis;
  const [values, setValues] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<{ text: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // «ابزارها» multi-select, bound to behaviour.service_prefs.
  const [prefs, setPrefs] = useState<string[]>([]);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  useEffect(() => {
    api<{ household: Record<string, string>; goals: { text: string }[] }>("/api/profile")
      .then((d) => {
        setValues(Object.fromEntries(Object.entries(d.household ?? {}).map(([k, v]) => [k, String(v)])));
        setGoals(d.goals ?? []);
        // draftFromProfile is the shared mapper: it filters service_prefs to
        // real strings, so the chips start from exactly what the server has.
        setPrefs(draftFromProfile(d).service_prefs ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await api("/api/profile", { method: "PUT", body: values });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    setPrefsBusy(true);
    setPrefsSaved(false);
    try {
      await api("/api/profile", { method: "PUT", body: { behaviour: { service_prefs: prefs } } });
      setPrefsSaved(true);
    } finally {
      setPrefsBusy(false);
    }
  }

  return (
    <AppShell>
      <ScreenHeader
        title="پروفایل خانوار"
        subtitle="این اطلاعات تحلیل قبض‌ها را دقیق‌تر می‌کند"
        trailing={
          <div className="grid size-9 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-foreground)]">
            <UserRound className="size-4" aria-hidden />
          </div>
        }
      />
      <div className="space-y-4">
        {loaded ? (
          <Card>
            <CardContent className="space-y-3 px-4">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs font-bold">{f.label}</Label>
                  <Input
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    inputMode={f.numeric ? "numeric" : "text"}
                    className="h-11 rounded-2xl"
                  />
                </div>
              ))}
              <Button
                className="h-12 w-full rounded-full text-base font-black"
                onClick={save}
                disabled={busy}
              >
                ذخیره
              </Button>
              {saved && (
                <p className="text-center text-xs font-bold text-[var(--primary)]">ذخیره شد ✅</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              …در حال بارگذاری
            </CardContent>
          </Card>
        )}

        {goals.length > 0 && (
          <Card className="bg-[var(--secondary)]/60">
            <CardContent className="space-y-2 px-4">
              <h2 className="font-black">🎯 هدف‌های من</h2>
              <ul className="space-y-2 text-sm leading-6">
                {goals.map((g, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                    {g.text}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {loaded && (
          <Card>
            <CardContent className="space-y-3 px-4">
              <div className="space-y-1">
                <h2 className="font-black">{t.title}</h2>
                <p className="text-sm font-bold leading-7">{t.prompt}</p>
              </div>
              <OptionCards
                options={TOOLBOX_OPTIONS.map(
                  (o): CardOption<string> => ({ label: o.label, value: o.value, emoji: toolboxEmojis[o.value] }),
                )}
                selected={prefs}
                onToggle={(value) =>
                  setPrefs((p) => toggleValue(p, value, TOOLBOX_OPTIONS.map((o) => o.value)))
                }
              />
              <Button
                variant="secondary"
                className="h-11 w-full rounded-full text-sm font-black"
                onClick={savePrefs}
                disabled={prefsBusy}
              >
                {t.saveBtn}
              </Button>
              {prefsSaved && (
                <p className="text-center text-xs font-bold text-[var(--primary)]">{t.savedMsg}</p>
              )}
              <p className="text-xs leading-6 text-[var(--muted-foreground)]">{t.hint}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
