// GET /api/admin/users?query= — user list with channels + counts (logic in lib/admin/queries).

import { listUsers } from "@/lib/admin/queries";
import { currentAdmin, unauth } from "@/lib/auth/api";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  const url = new URL(req.url);
  const query = url.searchParams.get("query")?.trim() ?? "";
  return Response.json({ users: listUsers(undefined, query) });
}
