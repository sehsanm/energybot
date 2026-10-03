// v2 chat pipeline: deterministic RAG — no tool-calling loop (spec §1).
// answerChat = one AI call; extractMemory = optional post-turn second call.

import { eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { aiChat } from "@/lib/ai/provider";
import { renderChatPersona } from "@/content/prompts/chatPersona";
import { renderMemoryExtraction } from "@/content/prompts/memoryExtraction";
import {
  recentHistory,
  renderKbBlocks,
  renderLatestBillLine,
  renderProfileSummary,
  searchKnowledgeBase,
} from "./context";
import { applyExtraction, listMemories, renderMemory } from "./memoryRepository";

export interface ChatAnswer {
  reply: string;
  kbHitTitles: string[];
}

export async function answerChat(userId: string, text: string, db: DB = getDb()): Promise<ChatAnswer> {
  const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get();
  const memories = listMemories(userId, db);
  const hits = searchKnowledgeBase(db, text);

  const system = renderChatPersona({
    profileSummary: renderProfileSummary(profile),
    latestBillLine: renderLatestBillLine(db, userId),
    memoryBlock: renderMemory(memories) || "(هنوز نکته‌ای درباره‌ی این کاربر در حافظه نیست.)",
    kbBlocks: renderKbBlocks(hits),
  });

  const history = recentHistory(db, userId);
  const messages = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.content })),
    { role: "user", content: text.slice(0, 2000) },
  ];

  const res = await aiChat(messages);
  return { reply: res.content.trim(), kbHitTitles: hits.map((h) => h.articleTitle) };
}

/** Post-turn memory upkeep; failures are logged and never bubble up. */
export async function extractMemory(userId: string, userText: string, reply: string, db: DB = getDb()): Promise<void> {
  if (!env.aiMemoryEnabled()) return;
  try {
    const memories = listMemories(userId, db);
    const prompt = renderMemoryExtraction({ currentMemories: memories, userText, assistantReply: reply });
    const res = await aiChat([{ role: "user", content: prompt }]);
    const extraction = parseExtraction(res.content);
    if (extraction) applyExtraction(userId, extraction, db);
  } catch (e) {
    console.warn("[chat] memory extraction failed:", String(e));
  }
}

function parseExtraction(text: string): { add?: { category?: string; text?: string }[]; remove_ids?: unknown[] } | null {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(t.slice(start, end + 1));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}
