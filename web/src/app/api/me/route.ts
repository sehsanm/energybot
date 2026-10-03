// GET /api/me — current user + fresh CSRF token.

import { currentUser } from "@/lib/auth/api";
import { signCsrf } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauth" }, { status: 401 });
  return Response.json({
    user: { id: user.id, displayName: user.displayName, language: user.language },
    csrf: signCsrf(user.sessionId),
  });
}
