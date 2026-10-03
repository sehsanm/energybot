// GET  /api/bills — list user's bills (newest first)
// POST /api/bills — capture a bill {text} or multipart formData (image|pdf)

import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { currentUser, badCsrf, csrfGuard, unauth } from "@/lib/auth/api";
import { captureBill } from "@/lib/billing/service";
import { billToJson } from "@/lib/billing/json";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  const rows = getDb()
    .select()
    .from(schema.bills)
    .where(eq(schema.bills.userId, user.id))
    .orderBy(desc(schema.bills.createdAt))
    .limit(50)
    .all();
  return Response.json({ bills: rows.map(billToJson) });
}

export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();

  const contentType = req.headers.get("content-type") ?? "";
  let input: { text?: string; imageBytes?: Buffer; pdfBytes?: Buffer };
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = (form.get("file") as File | null) ?? null;
      const text = (form.get("text") as string | null)?.trim() || undefined;
      if (file) {
        const bytes = Buffer.from(await file.arrayBuffer());
        const name = file.name.toLowerCase();
        const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
        input = isPdf ? { pdfBytes: bytes } : { imageBytes: bytes };
      } else {
        input = { text };
      }
    } else {
      const body = (await req.json()) as { text?: string };
      input = { text: body.text?.trim() || undefined };
    }
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const res = await captureBill(user.id, input);
  if (!res.ok) return Response.json({ error: res.error }, { status: 422 });
  const row = getDb().select().from(schema.bills).where(eq(schema.bills.id, res.billId)).get()!;
  return Response.json({ ok: true, bill: billToJson(row) });
}
