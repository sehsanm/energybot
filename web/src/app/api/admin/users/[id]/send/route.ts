// POST /api/admin/users/:id/send {text} — manual message/nudge via the user's bot channel.

import { getDb, now, schema } from "@/lib/db";
import { badCsrf, csrfGuard, currentAdmin, unauth } from "@/lib/auth/api";
import { deliverToUser } from "@/lib/channels/deliver";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  if (!csrfGuard(req, admin.sessionId)) return badCsrf();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) return Response.json({ error: "bad request" }, { status: 400 });

  const delivered = await deliverToUser(id, text.slice(0, 3000));
  if (!delivered.length) return Response.json({ error: "no active channel for user" }, { status: 422 });
  getDb().insert(schema.auditLog).values({
    adminId: admin.id,
    action: "user.send_message",
    entityType: "user",
    entityId: id,
    meta: JSON.stringify({ channels: delivered, length: text.length }),
    createdAt: now(),
  }).run();
  return Response.json({ ok: true, delivered });
}
