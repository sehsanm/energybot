// GET /api/admin/audit — recent admin actions.

import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { currentAdmin, unauth } from "@/lib/auth/api";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  const rows = getDb()
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(100)
    .all();
  return Response.json({
    entries: rows.map((r) => ({
      id: r.id,
      adminId: r.adminId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      meta: JSON.parse(r.meta ?? "{}"),
      createdAt: r.createdAt,
    })),
  });
}
