// Long-term user memory store — port of legacy memory/repository.py essentials.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";

export const MEMORY_CATEGORIES = ["preference", "life_context", "constraint", "interaction_style", "misc"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export const MEMORY_CAP = 40;

export interface MemoryItem {
  id: number;
  category: string;
  text: string;
}

export function listMemories(userId: string, db: DB = getDb()): MemoryItem[] {
  return db
    .select()
    .from(schema.userMemories)
    .where(and(eq(schema.userMemories.userId, userId), isNull(schema.userMemories.deletedAt)))
    .orderBy(asc(schema.userMemories.id))
    .all()
    .map((m) => ({ id: m.id, category: m.category, text: m.text }));
}

export function addMemory(userId: string, category: string, text: string, db: DB = getDb()): MemoryItem | null {
  const clean = text.trim().slice(0, 300);
  if (!clean) return null;
  const cat = (MEMORY_CATEGORIES as readonly string[]).includes(category) ? category : "misc";
  const res = db
    .insert(schema.userMemories)
    .values({ userId, category: cat, text: clean, createdAt: now(), updatedAt: now() })
    .run();
  return { id: Number(res.lastInsertRowid), category: cat, text: clean };
}

export function removeMemories(userId: string, ids: number[], db: DB = getDb()): number {
  const clean = ids.filter((n) => Number.isInteger(n));
  if (!clean.length) return 0;
  const res = db
    .update(schema.userMemories)
    .set({ deletedAt: now() })
    .where(
      and(
        eq(schema.userMemories.userId, userId),
        inArray(schema.userMemories.id, clean),
        isNull(schema.userMemories.deletedAt),
      ),
    )
    .run();
  return res.changes;
}

/** Apply an extraction result; returns the number of adds actually kept. */
export function applyExtraction(
  userId: string,
  extraction: { add?: { category?: string; text?: string }[]; remove_ids?: unknown[] },
  db: DB = getDb(),
): { added: number; removed: number } {
  const removed = removeMemories(
    userId,
    (extraction.remove_ids ?? []).map((x) => Number(x)).filter(Number.isFinite),
    db,
  );
  let added = 0;
  const current = listMemories(userId, db);
  for (const a of extraction.add ?? []) {
    if (current.length + added >= MEMORY_CAP) break;
    if (typeof a?.text !== "string" || !a.text.trim()) continue;
    if (addMemory(userId, String(a.category ?? "misc"), a.text, db)) added++;
  }
  return { added, removed };
}

// Render — port of legacy memory/render.py (order defines render order).
const HEADINGS: [MemoryCategory, string][] = [
  ["preference", "ترجیحات"],
  ["life_context", "شرایط زندگی"],
  ["constraint", "محدودیت‌ها"],
  ["interaction_style", "سبک تعامل"],
  ["misc", "سایر"],
];

export function renderMemory(items: MemoryItem[]): string {
  if (!items.length) return "";
  const known = new Set<string>(HEADINGS.map(([c]) => c));
  const byCat = new Map<string, MemoryItem[]>();
  for (const it of items) {
    const cat = known.has(it.category) ? it.category : "misc";
    byCat.set(cat, [...(byCat.get(cat) ?? []), it]);
  }
  const parts: string[] = ["آنچه درباره‌ی کاربر می‌دانم:"];
  for (const [cat, heading] of HEADINGS) {
    const rows = byCat.get(cat);
    if (!rows?.length) continue;
    parts.push(`${heading}:\n` + rows.map((it) => `- [${it.id}] ${it.text}`).join("\n"));
  }
  return parts.join("\n\n");
}
