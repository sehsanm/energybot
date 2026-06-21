"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, Gauge, BadgeCheck, ArrowLeft, CreditCard, TrendingUp, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConsumptionChart } from "@/components/ConsumptionChart";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { getDashboard, payBill, type DashboardData } from "@/lib/api";
import { UTIL, toman, faNum, faDate, billStatus } from "@/lib/format";

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  accent: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-bold tabular-nums">{value}</p>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", accent)}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-1" />
        <Skeleton className="h-72 lg:col-span-2" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [d, setD] = useState<DashboardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    getDashboard().then(setD).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const lastConsumption = d?.trend?.length ? d.trend[d.trend.length - 1].consumption : null;
  const chartData = (d?.trend ?? [])
    .filter((p) => p.term)
    .map((p) => ({ term: p.term as string, consumption: p.consumption }));

  async function pay() {
    if (!d?.latest_bill) return;
    setPaying(true);
    try {
      const url = await payBill(d.latest_bill.id);
      window.open(url, "_blank");
    } catch {
      /* ignore — payment errors are surfaced on the bills page */
    } finally {
      setPaying(false);
    }
  }

  const bill = d?.latest_bill ?? null;
  const status = bill ? billStatus(bill.status) : null;

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">داشبورد</h1>
          <p className="text-sm text-muted-foreground">نمای کلی مصرف و قبض‌های انرژی شما</p>
        </header>

        {!loaded ? (
          <DashboardSkeleton />
        ) : !d ? (
          <EmptyState
            icon={AlertCircle}
            title="بارگذاری اطلاعات ناموفق بود"
            description="ارتباط با سرور برقرار نشد. لطفاً صفحه را دوباره بارگذاری کنید."
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                icon={Wallet}
                label="آخرین مبلغ قبض"
                value={bill ? toman(bill.amount) : "—"}
                hint={bill ? `${UTIL(bill.utility_type)}${bill.term ? ` · دورهٔ ${bill.term}` : ""}` : "هنوز قبضی ثبت نشده"}
                accent="bg-accent/10 text-accent"
              />
              <StatCard
                icon={Gauge}
                label="آخرین مصرف"
                value={lastConsumption != null ? faNum(lastConsumption) : "—"}
                hint={bill?.term ? `دورهٔ ${bill.term}` : "بدون داده"}
                accent="bg-secondary/10 text-secondary"
              />
              <StatCard
                icon={BadgeCheck}
                label="تکمیل پروفایل"
                value={`${faNum(d.completeness_score)}٪`}
                hint="پروفایل کامل‌تر، پیشنهادهای دقیق‌تر"
                accent="bg-primary/10 text-primary"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle>آخرین قبض</CardTitle>
                </CardHeader>
                <CardContent>
                  {bill && status ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Badge variant="accent">{UTIL(bill.utility_type)}</Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">مبلغ قابل پرداخت</p>
                        <p className="text-2xl font-bold tabular-nums">{toman(bill.amount)}</p>
                      </div>
                      <dl className="space-y-2 border-t border-border pt-3 text-sm">
                        {bill.term && (
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">دوره</dt>
                            <dd className="font-medium">{bill.term}</dd>
                          </div>
                        )}
                        {bill.due_date && (
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">مهلت پرداخت</dt>
                            <dd className="font-medium">{faDate(bill.due_date)}</dd>
                          </div>
                        )}
                      </dl>
                      <Button onClick={pay} disabled={paying} className="w-full">
                        <CreditCard className="h-4 w-4" />
                        {paying ? "در حال انتقال…" : "پرداخت قبض"}
                      </Button>
                    </div>
                  ) : (
                    <EmptyState
                      icon={Wallet}
                      title="هنوز قبضی نداری"
                      description="یک شناسهٔ قبض ثبت کن تا این‌جا نمایش داده شود."
                      action={
                        <Link href="/bills">
                          <Button>استعلام قبض</Button>
                        </Link>
                      }
                    />
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>روند مصرف</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {chartData.length >= 2 ? (
                    <ConsumptionChart data={chartData} />
                  ) : (
                    <EmptyState
                      className="border-0 bg-transparent py-10"
                      icon={TrendingUp}
                      title="داده کافی برای نمودار نیست"
                      description="پس از ثبت چند قبض، روند مصرف این‌جا نمایش داده می‌شود."
                    />
                  )}
                </CardContent>
              </Card>
            </div>

            {d.completeness_score < 100 && (
              <Card>
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="w-full space-y-2 sm:max-w-md">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">تکمیل پروفایل</span>
                      <span className="tabular-nums text-muted-foreground">{faNum(d.completeness_score)}٪</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-l from-primary to-secondary transition-all"
                        style={{ width: `${d.completeness_score}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      با تکمیل پروفایل، پیشنهادهای صرفه‌جویی دقیق‌تری دریافت می‌کنی.
                    </p>
                  </div>
                  <Link href="/profile" className="shrink-0">
                    <Button variant="outline">
                      تکمیل پروفایل
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
