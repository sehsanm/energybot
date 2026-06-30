"use client";
import { useEffect, useState } from "react";
import { Receipt, RefreshCw, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api";

function Suggestions({ s }: { s: any }) {
  if (!s) return <p className="text-sm text-muted-foreground">پیشنهادی ثبت نشده.</p>;
  return (
    <div className="space-y-2 text-sm">
      {s.intro && <p className="text-foreground">{s.intro}</p>}
      {Array.isArray(s.tips) && s.tips.length > 0 && (
        <ul className="list-disc space-y-1 pr-5 text-muted-foreground">
          {s.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}
        </ul>
      )}
      {Array.isArray(s.targets) && s.targets.length > 0 && (
        <ul className="space-y-1">
          {s.targets.map((t: any, i: number) => (
            <li key={i} className="rounded-md bg-muted/50 p-2 text-foreground">{t.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BillsSection({ userId }: { userId: string }) {
  const [bills, setBills] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.getUserBills(userId).then((d) => setBills(d.bills)); }, [userId]);

  async function regenerate(billId: string) {
    setBusy(billId + ":regen"); setMsg(null);
    try {
      const r = await api.regenerateBillSuggestions(userId, billId);
      setBills((prev) => prev?.map((b) => (b.id === billId ? { ...b, suggestions: r.suggestions } : b)) ?? null);
      setMsg("پیشنهادها بازتولید شد.");
    } catch (e: any) { setMsg("خطا در بازتولید: " + e.message); }
    finally { setBusy(null); }
  }

  async function send(billId: string) {
    if (!window.confirm("پیشنهادهای این قبض برای کاربر ارسال شود؟")) return;
    setBusy(billId + ":send"); setMsg(null);
    try {
      await api.sendBillSuggestions(userId, billId);
      setMsg("برای کاربر ارسال شد.");
    } catch (e: any) { setMsg("خطا در ارسال: " + e.message); }
    finally { setBusy(null); }
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-secondary" /> قبض‌ها و پیشنهادها
        </CardTitle>
        <CardDescription>
          {bills ? `${bills.length.toLocaleString("fa-IR")} قبض` : "در حال بارگذاری…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {msg && <div className="rounded-md bg-muted/60 px-3 py-2 text-sm text-foreground">{msg}</div>}
        {bills && bills.length === 0 && <EmptyState icon={Receipt} title="قبضی ثبت نشده" />}
        {bills && bills.map((b) => (
          <div key={b.id} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{b.utility_type}</Badge>
                <span className="text-sm text-muted-foreground">دوره {b.term ?? "—"}</span>
              </div>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {Number(b.amount).toLocaleString("fa-IR")} ریال
              </span>
            </div>
            <Suggestions s={b.suggestions} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => regenerate(b.id)}>
                <RefreshCw className={busy === b.id + ":regen" ? "animate-spin" : ""} /> بازتولید
              </Button>
              <Button size="sm" disabled={busy !== null || !b.suggestions} onClick={() => send(b.id)}>
                <Send /> ارسال برای کاربر
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
