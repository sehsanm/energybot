"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getBills, inquireBill, payBill, type Subscription, type BillRow } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const UTIL = (t: string) => (t === "electricity" ? "برق" : t === "gas" ? "گاز" : "قبض");
const toman = (rial: number) => `${Math.floor(rial / 10).toLocaleString("fa-IR")} تومان`;

export default function BillsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [billId, setBillId] = useState("");
  const [result, setResult] = useState<{ summary: string; bill_db_id: string | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const d = await getBills();
    setSubs(d.subscriptions);
    setBills(d.bills);
  }
  useEffect(() => { refresh().catch(() => {}); }, []);

  async function onInquire() {
    const id = billId.trim();
    if (!id || busy) return;
    setBusy(true);
    try {
      const res = await inquireBill(id);
      setResult({ summary: res.summary, bill_db_id: res.ok ? res.bill_db_id : null, error: res.ok ? null : res.error });
      if (res.ok) { setBillId(""); refresh().catch(() => {}); }
    } catch { setResult({ summary: "", bill_db_id: null, error: "خطا در ارتباط با سرور" }); }
    finally { setBusy(false); }
  }

  async function onPay(id: string) {
    try { const url = await payBill(id); window.open(url, "_blank"); }
    catch { setResult({ summary: "", bill_db_id: null, error: "ایجاد لینک پرداخت ناموفق بود." }); }
  }

  const chartData = bills
    .filter((b) => b.consumption != null && b.term)
    .slice().reverse()
    .map((b) => ({ term: b.term as string, consumption: b.consumption as number }));

  return (
    <AppShell>
      <div dir="rtl" className="space-y-6">
        <h1 className="text-lg font-semibold">قبض‌ها</h1>

        <section className="space-y-2">
          <div className="flex gap-2">
            <input value={billId} onChange={(e) => setBillId(e.target.value)} placeholder="شناسهٔ قبض را وارد کن"
              className="flex-1 rounded-md border px-3 py-2 text-sm" />
            <button onClick={onInquire} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">استعلام</button>
          </div>
          {result && (
            <div className="rounded-md border p-3 text-sm">
              {result.error ? <p className="text-red-500">{result.error}</p> : <pre className="whitespace-pre-wrap font-sans">{result.summary}</pre>}
              {result.bill_db_id && (
                <button onClick={() => onPay(result.bill_db_id!)} className="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">پرداخت 💳</button>
              )}
              {result.bill_db_id && <p className="mt-1 text-xs text-muted-foreground">پس از پرداخت، تأیید در ربات بله هم برایت ارسال می‌شود.</p>}
            </div>
          )}
        </section>

        {subs.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">اشتراک‌ها</h2>
            <ul className="space-y-1 text-sm">
              {subs.map((s) => <li key={s.id} className="rounded-md border px-3 py-2">{UTIL(s.utility_type)} — {s.label || s.bill_id}</li>)}
            </ul>
          </section>
        )}

        {chartData.length >= 2 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">روند مصرف</h2>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <XAxis dataKey="term" /><YAxis /><Tooltip /><Line type="monotone" dataKey="consumption" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-medium">تاریخچهٔ قبض‌ها</h2>
          {bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز قبضی ثبت نشده — یک شناسهٔ قبض وارد کن.</p>
          ) : (
            <table className="w-full text-right text-sm">
              <thead><tr className="text-muted-foreground"><th className="py-1">نوع</th><th>دوره</th><th>مبلغ</th><th>مصرف</th><th>وضعیت</th></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="py-1">{UTIL(b.utility_type)}</td><td>{b.term || "-"}</td>
                    <td>{toman(b.amount)}</td><td>{b.consumption ?? "-"}</td><td>{b.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
