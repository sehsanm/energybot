"use client";

// Bills: upload (photo / PDF / typed id) + list with insights + regenerate.

import { useEffect, useRef, useState } from "react";
import { AppShell, Card, PrimaryButton } from "@/components/AppShell";
import { SessionGate } from "@/components/SessionGate";
import { api } from "@/lib/client/api";

interface Target {
  text: string;
  how?: string | null;
  saving_kwh?: number | null;
  saving_toman?: number | null;
  saving_pct?: number | null;
}
interface BillJson {
  id: string;
  billId: string;
  utilityLabel: string;
  amountLabel: string;
  term: string | null;
  dueDate: string | null;
  consumption: number | null;
  suggestions: { intro: string; tips: string[]; targets: Target[] } | null;
  createdAt: number;
}

function InsightsBlock({ bill, onRegen }: { bill: BillJson; onRegen: (id: string) => void }) {
  const s = bill.suggestions;
  if (!s) {
    return (
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <button onClick={() => onRegen(bill.id)} className="text-sm font-bold text-[var(--accent)]">
          💡 تولید پیشنهادهای صرفه‌جویی
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 text-sm leading-6">
      <p>{s.intro}</p>
      <ul className="list-inside list-disc space-y-1">
        {s.tips.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {s.targets?.length > 0 && (
        <div className="rounded-xl bg-[var(--bg)] p-3">
          <div className="mb-1 font-bold">🎯 هدف‌ها</div>
          {s.targets.map((t, i) => (
            <div key={i} className="mb-2">
              <div>{t.text}</div>
              {t.how && <div className="text-xs text-[var(--muted)]">چطور: {t.how}</div>}
            </div>
          ))}
        </div>
      )}
      <button onClick={() => onRegen(bill.id)} className="text-xs text-[var(--muted)] underline">
        تولید دوبارهٔ پیشنهادها
      </button>
    </div>
  );
}

function Bills() {
  const [bills, setBills] = useState<BillJson[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api<{ bills: BillJson[] }>("/api/bills").then((d) => setBills(d.bills)).catch(() => setBills([]));
  useEffect(() => {
    load();
  }, []);

  async function uploadText() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/bills", { method: "POST", body: { text: text.trim() } });
      setText("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api("/api/bills", { method: "POST", formData: fd });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function regen(id: string) {
    setBusy(true);
    try {
      await api(`/api/bills/${id}/insights`, { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-black">قبض‌های من</h1>

        <Card className="space-y-3">
          <div className="text-sm font-bold">ثبت قبض جدید</div>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="شناسه قبض (عدد اول کارت قبض)"
            inputMode="numeric"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-left text-sm outline-none focus:border-[var(--accent)]"
          />
          <PrimaryButton onClick={uploadText} loading={busy}>
            استعلام با شناسه
          </PrimaryButton>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--border)]" /> یا <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <PrimaryButton onClick={() => fileRef.current?.click()} loading={busy}>
            📸 عکس یا PDF قبض
          </PrimaryButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.target.value = "";
            }}
          />
          {error && <p className="text-xs text-[var(--warning)]">{error}</p>}
        </Card>

        {bills === null ? (
          <Card>…در حال بارگذاری</Card>
        ) : bills.length === 0 ? (
          <Card className="text-center text-sm text-[var(--muted)]">هنوز قبضی ثبت نشده است.</Card>
        ) : (
          bills.map((b) => (
            <Card key={b.id}>
              <div className="flex items-center justify-between">
                <span className="font-bold">📄 قبض {b.utilityLabel}</span>
                {b.term && <span className="text-xs text-[var(--muted)]">دوره {b.term}</span>}
              </div>
              <div className="mt-1 text-lg font-black">{b.amountLabel}</div>
              {b.consumption != null && (
                <div className="text-xs text-[var(--muted)]">مصرف: {b.consumption.toLocaleString("fa-IR")} kWh</div>
              )}
              {b.dueDate && <div className="text-xs text-[var(--muted)]">مهلت: {b.dueDate}</div>}
              <InsightsBlock bill={b} onRegen={regen} />
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}

export default function BillsPage() {
  return <SessionGate>{() => <Bills />}</SessionGate>;
}
