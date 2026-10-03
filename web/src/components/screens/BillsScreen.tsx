"use client";

// Bills screen (Stitch 03-bills): upload card + bill cards with insights,
// regenerate, celebration on freshly generated insights.

import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ScreenHeader } from "@/components/kit/ScreenHeader";
import { EmptyState } from "@/components/kit/EmptyState";
import { Confetti } from "@/components/kit/Confetti";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toFaDigits, nextBurst } from "@/components/kit/logic";
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
        <Button
          variant="secondary"
          className="h-9 w-full rounded-full text-xs font-bold"
          onClick={() => onRegen(bill.id)}
        >
          💡 تولید پیشنهادهای صرفه‌جویی
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 text-sm leading-6">
      <p>{s.intro}</p>
      <ul className="space-y-1.5">
        {s.tips.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--secondary)] text-[10px] font-black text-[var(--secondary-foreground)]">
              {toFaDigits(i + 1)}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
      {s.targets?.length > 0 && (
        <div className="rounded-2xl bg-[var(--secondary)] p-3">
          <div className="mb-1 font-black">🎯 هدف‌ها</div>
          {s.targets.map((t, i) => (
            <div key={i} className="mb-2">
              <div className="font-bold">{t.text}</div>
              {t.how && <div className="text-xs text-[var(--muted-foreground)]">چطور: {t.how}</div>}
            </div>
          ))}
        </div>
      )}
      <button onClick={() => onRegen(bill.id)} className="text-xs text-[var(--muted-foreground)] underline">
        تولید دوبارهٔ پیشنهادها
      </button>
    </div>
  );
}

export default function BillsScreen() {
  const [bills, setBills] = useState<BillJson[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
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
      setBurst((b) => nextBurst(b, "bill_insights_ready"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <Confetti burst={burst} />
      <ScreenHeader title="قبض‌های من" subtitle="استعلام، تحلیل و پیشنهاد صرفه‌جویی" />
      <div className="space-y-4">
        {/* Upload */}
        <Card className="bg-[var(--secondary)]/60">
          <CardContent className="space-y-3 px-4">
            <div className="text-sm font-black">ثبت قبض جدید</div>
            <div className="flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="شناسه قبض"
                inputMode="numeric"
                className="h-11 rounded-2xl bg-[var(--card)] text-left"
              />
              <Button
                className="h-11 shrink-0 rounded-2xl px-4 font-black"
                onClick={uploadText}
                disabled={busy || !text.trim()}
              >
                <Keyboard className="size-4" aria-hidden />
                استعلام
              </Button>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
              <span className="h-px flex-1 bg-[var(--border)]" /> یا <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
            <Button
              variant="secondary"
              className="h-11 w-full rounded-2xl font-black"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Camera className="size-4" aria-hidden />
              عکس یا PDF قبض
            </Button>
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
          </CardContent>
        </Card>

        {/* List */}
        {bills === null ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              …در حال بارگذاری
            </CardContent>
          </Card>
        ) : bills.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="هنوز قبضی ثبت نشده"
            desc="شناسه‌اش را بنویس یا عکسش را بفرست تا تحلیل کنم."
          />
        ) : (
          bills.map((b) => (
            <Card key={b.id}>
              <CardContent className="px-4">
                <div className="flex items-center justify-between">
                  <span className="font-black">📄 قبض {b.utilityLabel}</span>
                  {b.term && (
                    <Badge variant="secondary" className="rounded-full text-[10px]">
                      دوره {b.term}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-2xl font-black">{b.amountLabel}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--muted-foreground)]">
                  {b.consumption != null && <span>مصرف: {toFaDigits(b.consumption)} kWh</span>}
                  {b.dueDate && <span>مهلت: {b.dueDate}</span>}
                </div>
                <InsightsBlock bill={b} onRegen={regen} />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
