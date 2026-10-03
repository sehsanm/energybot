// POST /api/chat {text} — grounded AI reply (session + CSRF).
// GET  /api/chat — recent history.

import { desc, eq, and, inArray } from "drizzle-orm";
import { getDb, now, schema } from "@/lib/db";
import { badCsrf, csrfGuard, currentUser, unauth } from "@/lib/auth/api";
import { answerChat, extractMemory } from "@/lib/chat/pipeline";

export const runtime = "nodejs";

const MAX_TEXT = 2000;

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  const rows = getDb()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.userId, user.id))
    .orderBy(desc(schema.messages.id))
    .limit(50)
    .all()
    .reverse();
  return Response.json({
    messages: rows.map((m) => ({ role: m.role === "bot" ? "assistant" : m.role, content: m.content, createdAt: m.createdAt })),
  });
}

export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) return Response.json({ error: "bad request" }, { status: 400 });
  if (text.length > MAX_TEXT) return Response.json({ error: "پیام خیلی طولانی است." }, { status: 422 });

  const db = getDb();
  db.insert(schema.messages)
    .values({ userId: user.id, channel: "web", role: "user", content: text, createdAt: now() })
    .run();

  try {
    const res = await answerChat(user.id, text, db);
    db.insert(schema.messages)
      .values({ userId: user.id, channel: "web", role: "bot", content: res.reply, meta: JSON.stringify({ kind: "chat" }), createdAt: now() })
      .run();
    void extractMemory(user.id, text, res.reply, db).catch(() => undefined);
    return Response.json({ reply: res.reply });
  } catch (e) {
    console.error("[api/chat] failed:", e);
    return Response.json({ error: "پاسخ‌دهی الان ممکن نشد؛ دوباره تلاش کن." }, { status: 502 });
  }
}
