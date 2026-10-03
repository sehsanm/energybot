"use client";

// Profile screen: household basics that feed insight quality.

import { useEffect, useState } from "react";
import { AppShell, Card, PrimaryButton } from "@/components/AppShell";
import { api } from "@/lib/client/api";

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
  const [values, setValues] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<{ text: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ household: Record<string, string>; goals: { text: string }[] }>("/api/profile")
      .then((d) => {
        setValues(Object.fromEntries(Object.entries(d.household ?? {}).map(([k, v]) => [k, String(v)])));
        setGoals(d.goals ?? []);
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

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-black">پروفایل خانوار</h1>
        <p className="text-xs leading-6 text-[var(--muted)]">
          این اطلاعات تحلیل قبض‌ها را دقیق‌تر می‌کند (مثلاً مصرف به ازای هر نفر یا هر مترمربع).
        </p>
        {loaded ? (
          <Card className="space-y-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-sm font-bold">{f.label}</span>
                <input
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  inputMode={f.numeric ? "numeric" : "text"}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                />
              </label>
            ))}
            <PrimaryButton onClick={save} loading={busy}>
              ذخیره
            </PrimaryButton>
            {saved && <p className="text-center text-xs text-[var(--accent)]">ذخیره شد ✅</p>}
          </Card>
        ) : (
          <Card>…در حال بارگذاری</Card>
        )}
        {goals.length > 0 && (
          <Card>
            <h2 className="mb-2 font-bold">🎯 هدف‌های من</h2>
            <ul className="list-inside list-disc space-y-1 text-sm leading-6">
              {goals.map((g, i) => (
                <li key={i}>{g.text}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
