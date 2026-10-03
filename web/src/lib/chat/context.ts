// Context assembly for the chat pipeline — ports of the legacy renderers:
// profile summary (profile/render.py), memory (memory/render.py), plus a
// latest-bill headline and the KB hits block.

import { desc, eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { toPersianDigits } from "@/lib/format";
import { searchKb, type KbHit } from "@/lib/kb/repository";

const LABELS: [string, string][] = [
  ["city", "شهر"],
  ["home_type", "نوع مسکن"],
  ["occupants", "تعداد افراد خانوار"],
  ["area_m2", "متراژ"],
  ["heating_type", "سیستم گرمایش"],
  ["cooling_type", "سیستم سرمایش"],
  ["main_concern", "دغدغه اصلی"],
  ["main_utility", "قبض اصلی"],
];

export function renderProfileSummary(profile: typeof schema.profiles.$inferSelect | undefined): string {
  if (!profile) return "هنوز اطلاعاتی از این کاربر در دست نیست.";
  const household = JSON.parse(profile.household ?? "{}") as Record<string, unknown>;
  const behaviour = JSON.parse(profile.behaviour ?? "{}") as Record<string, unknown>;
  const goals = JSON.parse(profile.goals ?? "[]") as { text?: string; status?: string }[];
  const parts: string[] = [];
  const rows = LABELS.filter(([k]) => household[k] != null && household[k] !== "")
    .map(([k, label]) => `- ${label}: ${toPersianDigits(String(household[k]))}`);
  if (rows.length) parts.push("**اطلاعات خانه:**\n" + rows.join("\n"));
  const bRows = Object.entries(behaviour)
    .filter(([k, v]) => v != null && String(v) !== "" && k !== "onb_step")
    .map(([k, v]) => `- ${k}: ${toPersianDigits(String(v))}`);
  if (bRows.length) parts.push("**عادت‌های مصرف:**\n" + bRows.join("\n"));
  if (goals.length) {
    parts.push("**هدف‌ها:**\n" + goals.map((g) => `- ${g.text ?? ""} (${g.status ?? ""})`).join("\n"));
  }
  return parts.length ? parts.join("\n\n") : "هنوز اطلاعاتی از این کاربر در دست نیست.";
}

export function renderLatestBillLine(db: DB, userId: string): string {
  const bill = db
    .select()
    .from(schema.bills)
    .where(eq(schema.bills.userId, userId))
    .orderBy(desc(schema.bills.createdAt))
    .limit(1)
    .get();
  if (!bill) return "قبضی ثبت نشده است.";
  const kind = { electricity: "برق", gas: "گاز", water: "آب" }[bill.utilityType] ?? bill.utilityType;
  const toman = toPersianDigits(Math.floor(bill.amount / 10).toLocaleString("en-US"));
  const bits = [`${kind}: ${toman} تومان`];
  if (bill.term) bits.push(`دورهٔ ${bill.term}`);
  if (bill.consumption != null) bits.push(`${toPersianDigits(String(bill.consumption))} کیلووات‌ساعت`);
  return bits.join(" · ");
}

export function renderKbBlocks(hits: KbHit[]): { title: string; text: string }[] {
  return hits.map((h) => ({ title: h.articleTitle, text: h.chunkText }));
}

export interface HistoryTurn {
  role: "user" | "bot";
  content: string;
}

/** Last N exchanges (2N rows) for the user, oldest → newest. */
export function recentHistory(db: DB, userId: string, exchanges = 8): HistoryTurn[] {
  const rows = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.userId, userId))
    .orderBy(desc(schema.messages.id))
    .limit(exchanges * 2)
    .all()
    .reverse();
  return rows
    .filter((m) => (m.role === "user" || m.role === "bot") && m.content.trim() !== "")
    .map((m) => ({ role: m.role as "user" | "bot", content: m.content.slice(0, 2000) }));
}

export function searchKnowledgeBase(db: DB, query: string, k = 4): KbHit[] {
  return searchKb(db, query, k);
}
