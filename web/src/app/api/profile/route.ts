// GET/PUT /api/profile — household basics that feed bill insights.

import { eq } from "drizzle-orm";
import { getDb, now, schema } from "@/lib/db";
import { badCsrf, csrfGuard, unauth, currentUser } from "@/lib/auth/api";

export const runtime = "nodejs";

const FIELDS = ["city", "home_type", "occupants", "area_m2", "heating_type", "cooling_type", "main_concern"] as const;

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  const row = getDb().select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get();
  return Response.json({
    household: row ? JSON.parse(row.household) : {},
    goals: row ? JSON.parse(row.goals ?? "[]") : [],
  });
}

export async function PUT(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "bad request" }, { status: 400 });

  const db = getDb();
  const row = db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get();
  const household: Record<string, unknown> = row ? JSON.parse(row.household) : {};
  for (const f of FIELDS) {
    if (body[f] !== undefined) household[f] = String(body[f]).slice(0, 120);
  }
  if (row) {
    db.update(schema.profiles)
      .set({ household: JSON.stringify(household), updatedAt: now() })
      .where(eq(schema.profiles.userId, user.id))
      .run();
  } else {
    db.insert(schema.profiles)
      .values({ userId: user.id, household: JSON.stringify(household), updatedAt: now() })
      .run();
  }
  return Response.json({ ok: true, household });
}
