// Port of legacy seed prompt `bill_suggestions.md` (Jinja) — restructured as a
// plain TS template with precomputed display lines; content preserved.

import type { SuggestionContext } from "@/lib/billing/suggestions";
import { fmtAmountRial, fmtKwh } from "@/lib/format";

function householdLine(h: Record<string, unknown>): string {
  const v = (k: string, fallback = "نامشخص") => (h[k] != null && h[k] !== "" ? String(h[k]) : fallback);
  return `- شهر: ${v("city")} | نوع منزل: ${v("home_type")} | ساکنان: ${v("occupants")} | متراژ: ${v("area_m2")}\n` +
    `- گرمایش: ${v("heating_type")} | سرمایش: ${v("cooling_type")} | دغدغه: ${v("main_concern")}`;
}

export function renderBillSuggestionsPrompt(c: SuggestionContext): string {
  const bits: string[] = [`اطلاعات این قبض (${c.utilityKind}):`];
  let period = `- دوره: ${c.term ?? "نامشخص"}`;
  if (c.season) period += `، فصل: ${c.season}`;
  if (c.days) period += `، ${c.days} روز`;
  bits.push(period);
  if (c.amountToman != null) {
    let amount = `- مبلغ این دوره: ${fmtAmountRial(c.amountToman * 10)}`; // fmt expects rial
    if (c.energyToman != null) {
      amount += ` (انرژی: ${fmtAmountRial(c.energyToman * 10)}` +
        `, مالیات/عوارض: ${fmtAmountRial((c.taxToman ?? 0) * 10)}` +
        `, آبونمان: ${fmtAmountRial((c.subscriptionToman ?? 0) * 10)})`;
    }
    bits.push(amount);
  }
  let cons = `- مصرف کل: ${c.totalKwh != null ? fmtKwh(c.totalKwh) : "نامشخص"} کیلووات‌ساعت`;
  if (c.kwhPerDay != null) cons += `، ${fmtKwh(c.kwhPerDay)} در روز`;
  bits.push(cons);
  const bucket = (label: string, v: number | null, pct: number | null) => {
    if (v == null && pct == null) return `${label}: نامشخص`;
    if (pct == null) return `${label}: ${fmtKwh(v as number)}`;
    return `${label}: ${fmtKwh(v as number)} (${pct}٪)`;
  };
  bits.push(
    `- ${bucket("اوج", c.peakKwh, c.peakPct)} | ${bucket("عادی", c.normalKwh, c.normalPct)} | ${bucket("کم‌باری", c.lowKwh, c.lowPct)}`,
  );
  if (c.kwhPerPerson != null) bits.push(`- مصرف به ازای هر نفر: ${fmtKwh(c.kwhPerPerson)} کیلووات‌ساعت`);
  if (c.kwhPerM2 != null) bits.push(`- مصرف به ازای هر مترمربع: ${fmtKwh(c.kwhPerM2)} کیلووات‌ساعت`);
  if (c.tariff) {
    let t = `- تعرفه: ${c.tariff}`;
    if (c.phase) t += `، فاز: ${c.phase}`;
    if (c.amper) t += `، آمپر: ${c.amper}`;
    bits.push(t);
  }

  bits.push("", "پروفایل خانوار:", householdLine(c.household));
  if (c.behaviour && Object.keys(c.behaviour).length) {
    bits.push(`- رفتار مصرف: ${JSON.stringify(c.behaviour, null, 0)}`);
  }
  bits.push("");
  if (c.prev) {
    let p = `قبض دوره قبل: مصرف ${c.prev.totalKwh ?? "نامشخص"} کیلووات‌ساعت، مبلغ ${c.prev.amountToman ?? "نامشخص"} تومان`;
    if (c.prev.deltaKwh != null) p += ` — تغییر مصرف: ${c.prev.deltaKwh} کیلووات‌ساعت (${c.prev.deltaPct ?? "?"}٪)`;
    p += ".";
    bits.push(p);
  } else {
    bits.push("قبض دوره قبلی ثبت نشده است.");
  }
  if (c.userMemory) bits.push(`آنچه از گفتگوهای قبلی درباره کاربر می‌دانیم: ${c.userMemory}`);

  return [
    "تو یک مشاور صرفه‌جویی انرژی فارسی‌زبان، دقیق و عددمحور هستی. فقط بر اساس داده‌های همین قبض و همین خانوار، پیشنهاد بده. از کلی‌گویی پرهیز کن؛ هر مشاهده را به یک عددِ همین قبض گره بزن.",
    "",
    ...bits,
    "",
    "قواعد خروجی:",
    "- فقط یک شیء JSON معتبر بده. هیچ متنی بیرون از JSON ننویس.",
    "- همه متن‌ها فارسی، کوتاه و عملی. هر پیشنهاد به الگوی همین قبض گره بخورد.",
    "- `intro`: یک تا دو جمله؛ اگر قبض قبلی هست به تغییر مصرف اشاره کن.",
    "- `tips`: ۳ تا ۵ اقدام مشخص و عملی.",
    "- `targets`: ۱ تا ۳ هدف کاملاً کمّی با مقدار پایه، مقدار هدف، میزان صرفه‌جویی عددی و «چطور» محقق می‌شود.",
    "- برای هر هدف: `text`، `metric` (یکی از \"peak_kwh\" | \"total_kwh\" | \"amount_toman\")، `baseline`، `target_value`، `saving_kwh`، `saving_toman`، `saving_pct`، `how`، `target_date` (تاریخ شمسی یا null).",
    "- همه صرفه‌جویی‌ها تخمینی‌اند؛ غیرواقعی بزرگ‌نمایی نکن.",
    "",
    'ساختار خروجی:',
    '{"intro": "...", "tips": ["...", "..."], "targets": [{"text": "...", "metric": "peak_kwh", "baseline": 0, "target_value": 0, "saving_kwh": 0, "saving_toman": 0, "saving_pct": 0, "how": "...", "target_date": "1405/05/31"}]}',
  ].join("\n");
}
