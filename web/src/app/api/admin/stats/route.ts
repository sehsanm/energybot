// GET /api/admin/stats — dashboard numbers (logic in lib/admin/queries).

import { buildStats } from "@/lib/admin/queries";
import { currentAdmin, unauth } from "@/lib/auth/api";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  return Response.json(buildStats());
}
