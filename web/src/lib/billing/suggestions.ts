// Port of legacy src/energybot/billing/suggestions.py — quantified bill insights:
// context builder (seasons, densities, deltas), strict JSON parsing, Persian
// rendering, and targets→profile-goals conversion.

import { randomUUID } from "node:crypto";
import { renderBillSuggestionsPrompt } from "@/content/prompts/billSuggestions";
import { aiChat } from "@/lib/ai/provider";
import { toPersianDigits } from "@/lib/format";
import { normalizeFaDigits } from "./billNumbers";

const JALALI_SEASONS: Record<number, string> = {
  1: "بهار", 2: "بهار", 3: "بهار",
  4: "تابستان", 5: "تابستان", 6: "تابستان",
  7: "پاییز", 8: "پاییز", 9: "پاییز",
  10: "زمستان", 11: "زمستان", 12: "زمستان",
};

function seasonForJalaliDate(s: string | null | undefined): { season: string | null; month: number | null } {
  if (!s) return { season: null, month: null };
  const parts = normalizeFaDigits(s).split("/");
  if (parts.length < 2) return { season: null, month: null };
  const month = Number(parts[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return { season: null, month: null };
  return { season: JALALI_SEASONS[month], month };
}

export interface SuggestionTarget {
  text: string;
  metric?: string | null;
  baseline?: number | null;
  target_value?: number | null;
  saving_kwh?: number | null;
  saving_toman?: number | null;
  saving_pct?: number | null;
  how?: string | null;
  target_date?: string | null;
}

export interface SuggestionsPayload {
  generatedAt: number;
  intro: string;
  tips: string[];
  targets: SuggestionTarget[];
  model: string;
}

export interface SuggestionContext {
  utilityKind: string;
  amountToman: number | null;
  energyToman: number | null;
  taxToman: number | null;
  subscriptionToman: number | null;
  term: string | null;
  season: string | null;
  jalaliMonth: number | null;
  days: number | null;
  kwhPerDay: number | null;
  totalKwh: number | null;
  peakKwh: number | null;
  normalKwh: number | null;
  lowKwh: number | null;
  fridayKwh: number | null;
  peakPct: number | null;
  normalPct: number | null;
  lowPct: number | null;
  fridayPct: number | null;
  kwhPerPerson: number | null;
  kwhPerM2: number | null;
  tariff: string | null;
  phase: number | null;
  amper: number | null;
  customerType: string | null;
  household: Record<string, unknown>;
  behaviour: Record<string, unknown>;
  prev: {
    amountToman: number | null;
    totalKwh: number | null;
    term: string | null;
    deltaKwh: number | null;
    deltaPct: number | null;
    deltaToman: number | null;
  } | null;
  userMemory: string | null;
}

/** Bill shape consumed here — matches drizzle rows and Finnotech details JSON. */
export interface BillLike {
  utilityType: string;
  amount: number; // rial
  term: string | null;
  details: Record<string, unknown>;
}

export interface ProfileLike {
  household: Record<string, unknown>;
  behaviour: Record<string, unknown>;
}

/** Free-form profile values arrive as buckets like "<60" or "100-150" — coerce to numbers. */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return v;
  const s = normalizeFaDigits(String(v)).replace(/,/g, "").replace("٫", ".").trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  const body = s.replace(/^[<>≤≥]+/, "").replace(/\+$/, "").trim();
  const bounded = Number(body);
  if (Number.isFinite(bounded)) return bounded;
  if (body.includes("-")) {
    const [lo, hi] = body.split("-");
    const a = Number(lo);
    const b = Number(hi);
    if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
  }
  return null;
}

function pct(part: unknown, total: unknown): number | null {
  const p = toNumber(part);
  const t = toNumber(total);
  if (p === null || !t) return null;
  return Math.round((100 * p) / t);
}

function ratio(total: unknown, divisor: unknown, digits = 1): number | null {
  const t = toNumber(total);
  const d = toNumber(divisor);
  if (t === null || !d) return null;
  return Number((t / d).toFixed(digits));
}

function toman(rial: unknown): number | null {
  const r = toNumber(rial);
  return r === null ? null : Math.floor(r / 10);
}

export function buildSuggestionContext(
  bill: BillLike,
  profile: ProfileLike | null,
  prev: BillLike | null,
): SuggestionContext {
  const details = bill.details ?? {};
  const cons = (details.consumption ?? {}) as Record<string, unknown>;
  const amounts = (details.amounts ?? {}) as Record<string, unknown>;
  const reading = (details.reading ?? {}) as Record<string, unknown>;
  const period = (details.period ?? {}) as Record<string, unknown>;
  const household = profile?.household ?? {};

  const total = toNumber(cons.total);
  const peak = toNumber(cons.peak);
  const normal = toNumber(cons.normal);
  const low = toNumber(cons.low);
  const friday = toNumber(cons.friday);
  const days = toNumber(period.days);
  const { season, month } = seasonForJalaliDate(reading.currentDate as string | undefined);
  const amountTomanVal = toman(amounts.period ?? bill.amount);

  let prevBlock: SuggestionContext["prev"] = null;
  if (prev) {
    const pdet = prev.details ?? {};
    const ptotal = toNumber(((pdet.consumption ?? {}) as Record<string, unknown>).total);
    const pamount = toman(((pdet.amounts ?? {}) as Record<string, unknown>).period ?? prev.amount);
    prevBlock = {
      amountToman: pamount,
      totalKwh: ptotal,
      term: prev.term,
      deltaKwh: total !== null && ptotal !== null ? Number((total - ptotal).toFixed(1)) : null,
      deltaPct: total !== null && ptotal ? pct(total - ptotal, ptotal) : null,
      deltaToman: amountTomanVal !== null && pamount !== null ? amountTomanVal - pamount : null,
    };
  }

  return {
    utilityKind: { electricity: "برق", gas: "گاز", water: "آب" }[bill.utilityType] ?? "قبض",
    amountToman: amountTomanVal,
    energyToman: toman(amounts.energy),
    taxToman: toman(amounts.tax),
    subscriptionToman: toman(amounts.subscription),
    term: bill.term,
    season,
    jalaliMonth: month,
    days,
    kwhPerDay: ratio(total, days),
    totalKwh: total,
    peakKwh: peak,
    normalKwh: normal,
    lowKwh: low,
    fridayKwh: friday,
    peakPct: pct(peak, total),
    normalPct: pct(normal, total),
    lowPct: pct(low, total),
    fridayPct: pct(friday, total),
    kwhPerPerson: ratio(total, household.occupants),
    kwhPerM2: ratio(total, household.area_m2),
    tariff: (details.tariff as string) ?? null,
    phase: toNumber(details.phase),
    amper: toNumber(details.amper),
    customerType: (details.customerType as string) ?? null,
    household,
    behaviour: profile?.behaviour ?? {},
    prev: prevBlock,
    userMemory: null,
  };
}

export function parseSuggestionsJson(
  text: string | null | undefined,
): Omit<SuggestionsPayload, "model"> | null {
  if (!text) return null;
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let data: any;
  try {
    data = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { intro, tips, targets } = data;
  if (typeof intro !== "string") return null;
  if (!Array.isArray(tips) || !tips.every((x: unknown) => typeof x === "string")) return null;
  if (!Array.isArray(targets)) return null;
  return {
    generatedAt: Date.now(),
    intro: intro.trim(),
    tips: (tips as string[]).map((x) => x.trim()).filter(Boolean),
    targets: (targets as any[]).filter((x) => x && typeof x === "object" && typeof x.text === "string"),
  };
}

function fmtSaving(t: SuggestionTarget): string | null {
  const bits: string[] = [];
  if (typeof t.saving_kwh === "number") bits.push(`${toPersianDigits(Math.round(t.saving_kwh).toLocaleString("en-US"))} کیلووات‌ساعت`);
  if (typeof t.saving_toman === "number") bits.push(`${toPersianDigits(Math.floor(t.saving_toman).toLocaleString("en-US"))} تومان`);
  if (typeof t.saving_pct === "number") bits.push(`${toPersianDigits(String(t.saving_pct))}٪`);
  return bits.length ? "صرفه‌جویی حدود " + bits.join(" / ") : null;
}

export function renderSuggestions(payload: { intro: string; tips: string[]; targets: SuggestionTarget[] }): string {
  const lines = ["💡 پیشنهادها برای این قبض"];
  if (payload.intro?.trim()) lines.push(payload.intro.trim());
  if (payload.tips?.length) {
    lines.push("");
    lines.push(...payload.tips.map((t) => `• ${t}`));
  }
  if (payload.targets?.length) {
    lines.push("", "🎯 هدف‌ها");
    for (const t of payload.targets) {
      lines.push(`- ${t.text ?? ""}`);
      const saving = fmtSaving(t);
      if (saving) lines.push(`  ${saving}`);
      if (t.how?.trim()) lines.push(`  چطور: ${t.how.trim()}`);
    }
  }
  return lines.join("\n");
}

export function targetsAsGoals(targets: SuggestionTarget[], billId: string): Record<string, unknown>[] {
  return targets.map((t) => ({
    id: randomUUID(),
    text: t.text ?? "",
    status: "active",
    source: "bill_suggestion",
    billId,
    metric: t.metric ?? null,
    baseline: t.baseline ?? null,
    targetValue: t.target_value ?? null,
    savingKwh: t.saving_kwh ?? null,
    savingToman: t.saving_toman ?? null,
    savingPct: t.saving_pct ?? null,
    how: t.how ?? null,
    targetDate: t.target_date ?? null,
  }));
}

/** Generate insights via the AI endpoint; returns null on any failure (non-fatal). */
export async function generateSuggestions(
  bill: BillLike,
  profile: ProfileLike | null,
  prev: BillLike | null,
): Promise<SuggestionsPayload | null> {
  let content: string;
  let model: string;
  try {
    const prompt = renderBillSuggestionsPrompt(buildSuggestionContext(bill, profile, prev));
    const res = await aiChat([{ role: "user", content: prompt }]);
    content = res.content;
    model = res.model;
  } catch (err) {
    console.warn("[suggestions] ai call failed:", String(err));
    return null;
  }
  const parsed = parseSuggestionsJson(content);
  if (!parsed) {
    console.warn("[suggestions] parse failed");
    return null;
  }
  return { ...parsed, model };
}
