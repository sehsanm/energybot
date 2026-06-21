"use client";
import { useEffect, useState } from "react";
import { Search, CreditCard, Receipt, Zap, Flame, Droplet, TrendingUp, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConsumptionChart } from "@/components/ConsumptionChart";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getBills, inquireBill, payBill, type Subscription, type BillRow } from "@/lib/api";
import { UTIL, toman, faNum, billStatus } from "@/lib/format";

const utilityIcon = (t: string): LucideIcon =>
  t === "electricity" ? Zap : t === "gas" ? Flame : t === "water" ? Droplet : Receipt;

export default function BillsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [billId, setBillId] = useState("");
  const [result, setResult] = useState<{ summary: string; bill_db_id: string | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const d = await getBills();
    setSubs(d.subscriptions);
    setBills(d.bills);
  }
  useEffect(() => {
    refresh().catch(() => {}).finally(() => setLoaded(true));
  }, []);

  async function onInquire() {
    const id = billId.trim();
    if (!id || busy) return;
    setBusy(true);
    try {
      const res = await inquireBill(id);
      setResult({ summary: res.summary, bill_db_id: res.ok ? res.bill_db_id : null, error: res.ok ? null : res.error });
      if (res.ok) {
        setBillId("");
        refresh().catch(() => {});
      }
    } catch {
      setResult({ summary: "", bill_db_id: null, error: "خطا در ارتباط با سرور" });
    } finally {
      setBusy(false);
    }
  }

  async function onPay(id: string) {
    try {
      const url = await payBill(id);
      window.open(url, "_blank");
    } catch {
      setResult({ summary: "", bill_db_id: null, error: "ایجاد لینک پرداخت ناموفق بود." });
    }
  }

  const chartData = bills
    .filter((b) => b.consumption != null && b.term)
    .slice()
    .reverse()
    .map((b) => ({ term: b.term as string, consumption: b.consumption as number }));

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">قبض‌ها</h1>
          <p className="text-sm text-muted-foreground">استعلام، پرداخت و پیگیری مصرف قبض‌های انرژی</p>
        </header>

        {/* inquiry */}
        <Card>
          <CardHeader>
            <CardTitle>استعلام قبض</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                onInquire();
              }}
            >
              <Input
                value={billId}
                onChange={(e) => setBillId(e.target.value)}
                inputMode="numeric"
                placeholder="شناسهٔ قبض را وارد کن"
                className="flex-1"
                aria-label="شناسهٔ قبض"
              />
              <Button type="submit" disabled={busy || !billId.trim()} className="sm:w-32">
                <Search className="h-4 w-4" />
                {busy ? "در حال استعلام…" : "استعلام"}
              </Button>
            </form>

            {result && (
              <div
                className={
                  result.error
                    ? "flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                    : "rounded-lg border border-border bg-muted/40 p-4"
                }
              >
                {result.error ? (
                  <>
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{result.error}</p>
                  </>
                ) : (
                  <div className="space-y-3">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-foreground">{result.summary}</pre>
                    {result.bill_db_id && (
                      <div className="space-y-1.5 border-t border-border pt-3">
                        <Button onClick={() => onPay(result.bill_db_id!)}>
                          <CreditCard className="h-4 w-4" />
                          پرداخت قبض
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          پس از پرداخت، تأیید در ربات بله هم برایت ارسال می‌شود.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* subscriptions */}
        {subs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>اشتراک‌ها</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2">
                {subs.map((s) => {
                  const Icon = utilityIcon(s.utility_type);
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{s.label || s.bill_id}</p>
                        <p className="text-xs text-muted-foreground">{UTIL(s.utility_type)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* trend */}
        {chartData.length >= 2 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>روند مصرف</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <ConsumptionChart data={chartData} height={240} />
            </CardContent>
          </Card>
        )}

        {/* history */}
        <Card>
          <CardHeader>
            <CardTitle>تاریخچهٔ قبض‌ها</CardTitle>
          </CardHeader>
          <CardContent>
            {!loaded ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : bills.length === 0 ? (
              <EmptyState
                className="border-0 bg-transparent"
                icon={Receipt}
                title="هنوز قبضی ثبت نشده"
                description="یک شناسهٔ قبض را در کادر بالا وارد کن تا این‌جا ثبت شود."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>نوع</TableHead>
                    <TableHead>دوره</TableHead>
                    <TableHead>مبلغ</TableHead>
                    <TableHead>مصرف</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="text-end">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((b) => {
                    const st = billStatus(b.status);
                    const Icon = utilityIcon(b.utility_type);
                    return (
                      <TableRow key={b.id}>
                        <TableCell>
                          <span className="flex items-center gap-2 font-medium">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            {UTIL(b.utility_type)}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{b.term || "—"}</TableCell>
                        <TableCell className="tabular-nums">{toman(b.amount)}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {b.consumption != null ? faNum(b.consumption) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          {b.status !== "paid" ? (
                            <Button size="sm" variant="outline" onClick={() => onPay(b.id)}>
                              <CreditCard className="h-3.5 w-3.5" />
                              پرداخت
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
