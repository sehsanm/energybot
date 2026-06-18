"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getDashboard, payBill, type DashboardData } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const UTIL = (t: string) => (t === "electricity" ? "برق" : t === "gas" ? "گاز" : "قبض");
const toman = (rial: number) => `${Math.floor(rial / 10).toLocaleString("fa-IR")} تومان`;

export default function DashboardPage() {
  const [d, setD] = useState<DashboardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { getDashboard().then(setD).catch(() => {}).finally(() => setLoaded(true)); }, []);

  return (
    <AppShell>
      <div dir="rtl" className="space-y-6">
        <h1 className="text-lg font-semibold">داشبورد</h1>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
        ) : !d ? (
          <p className="text-sm text-muted-foreground">بارگذاری اطلاعات ناموفق بود.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-lg border p-4">
              <h2 className="mb-2 text-sm font-medium">تکمیل پروفایل</h2>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>وضعیت</span><span>{d.completeness_score}٪</span></div>
              <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${d.completeness_score}%` }} /></div>
              {d.completeness_score < 100 && <a href="/app/profile" className="mt-2 inline-block text-xs text-primary hover:underline">تکمیل پروفایل</a>}
            </section>

            <section className="rounded-lg border p-4">
              <h2 className="mb-2 text-sm font-medium">آخرین قبض</h2>
              {d.latest_bill ? (
                <div className="space-y-1 text-sm">
                  <div>{UTIL(d.latest_bill.utility_type)} — {toman(d.latest_bill.amount)}</div>
                  {d.latest_bill.term && <div className="text-muted-foreground">دوره: {d.latest_bill.term}</div>}
                  {d.latest_bill.due_date && <div className="text-muted-foreground">مهلت: {d.latest_bill.due_date}</div>}
                  <button
                    onClick={() => { const id = d.latest_bill!.id; payBill(id).then((u) => window.open(u, "_blank")).catch(() => {}); }}
                    className="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">پرداخت 💳</button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">هنوز قبضی نداری — <a href="/app/bills" className="text-primary hover:underline">استعلام بزن</a></p>
              )}
            </section>

            <section className="rounded-lg border p-4 sm:col-span-2">
              <h2 className="mb-2 text-sm font-medium">روند مصرف</h2>
              {d.trend.length >= 2 ? (
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={d.trend}><XAxis dataKey="term" /><YAxis /><Tooltip /><Line type="monotone" dataKey="consumption" /></LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">داده کافی برای نمودار نیست.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
