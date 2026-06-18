"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getProfile, patchProfile, addProfileItem, removeProfileItem, type ProfileData } from "@/lib/api";

// occupants is stored normalized to an int (e.g. "5+" -> 5); map back to the option label.
function fieldValue(p: ProfileData, key: string): string {
  const v = (p.household as Record<string, unknown>)[key];
  if (v == null) return "";
  if (key === "occupants") { const n = Number(v); return n >= 5 ? "5+" : String(n); }
  return String(v);
}

export default function ProfilePage() {
  const [p, setP] = useState<ProfileData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [commitText, setCommitText] = useState("");

  useEffect(() => { getProfile().then(setP).catch(() => {}); }, []);
  if (!p) return <AppShell><p className="text-sm">در حال بارگذاری…</p></AppShell>;

  async function save(path: string, value: string) {
    setErr(null);
    try { setP(await patchProfile(path, value)); }
    catch { setErr("ذخیره نشد؛ مقدار نامعتبر است."); getProfile().then(setP).catch(() => {}); }
  }

  const behaviourEntries = Object.entries(p.behaviour || {});

  return (
    <AppShell>
      <div dir="rtl" className="space-y-6 max-w-xl">
        <h1 className="text-lg font-semibold">پروفایل</h1>

        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>تکمیل پروفایل</span><span>{p.completeness_score}٪</span></div>
          <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${p.completeness_score}%` }} /></div>
        </div>

        {err && <p className="text-sm text-red-500">{err}</p>}

        <section className="space-y-3">
          <h2 className="text-sm font-medium">مشخصات خانه</h2>
          {p.fields.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{f.label}</span>
              {f.options ? (
                <select value={fieldValue(p, f.key)} onChange={(e) => save(f.path, e.target.value)}
                  className="w-full rounded-md border px-3 py-2">
                  <option value="" disabled>انتخاب کن…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input key={`${f.key}-${fieldValue(p, f.key)}`} defaultValue={fieldValue(p, f.key)} onBlur={(e) => { if (e.target.value.trim()) save(f.path, e.target.value.trim()); }}
                  className="w-full rounded-md border px-3 py-2" />
              )}
            </label>
          ))}
        </section>

        <ChipSection title="اهداف" items={p.goals} value={goalText} setValue={setGoalText}
          onAdd={async (t) => setP(await addProfileItem("goals", t))}
          onRemove={async (i) => setP(await removeProfileItem("goals", i))} empty="هنوز هدفی ثبت نشده" />

        <ChipSection title="تعهدها" items={p.commitments} value={commitText} setValue={setCommitText}
          onAdd={async (t) => setP(await addProfileItem("commitments", t))}
          onRemove={async (i) => setP(await removeProfileItem("commitments", i))} empty="هنوز تعهدی ثبت نشده" />

        {behaviourEntries.length > 0 && (
          <section>
            <h2 className="mb-1 text-sm font-medium">عادت‌ها <span className="text-xs text-muted-foreground">(به‌صورت خودکار از گفتگوها یاد گرفته شده)</span></h2>
            <ul className="text-sm text-muted-foreground">
              {behaviourEntries.map(([k, v]) => <li key={k}>{k}: {String(v)}</li>)}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function ChipSection(props: {
  title: string; items: string[]; value: string; setValue: (s: string) => void; empty: string;
  onAdd: (t: string) => Promise<void>; onRemove: (i: number) => Promise<void>;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{props.title}</h2>
      {props.items.length === 0 && <p className="text-sm text-muted-foreground">{props.empty}</p>}
      <div className="flex flex-wrap gap-2">
        {props.items.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
            {it}<button onClick={() => props.onRemove(i).catch(() => {})} className="text-muted-foreground hover:text-foreground">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={props.value} onChange={(e) => props.setValue(e.target.value)} placeholder="افزودن…"
          className="flex-1 rounded-md border px-3 py-2 text-sm" />
        <button onClick={async () => { const t = props.value.trim(); if (!t) return; try { await props.onAdd(t); props.setValue(""); } catch { /* keep typed text so the user can retry */ } }}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">افزودن</button>
      </div>
    </section>
  );
}
