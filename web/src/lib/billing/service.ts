// Port of legacy billing/service.py (capture path only — payments dropped).

import { and, desc, eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, now, schema, type DB } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtAmountRial, fmtKwh } from "@/lib/format";
import { parseBillNumbers, type BillNumbers } from "./billNumbers";
import { extractFromImage, extractFromPdf } from "./extract";
import { FinnotechClient, FakeFinnotechClient, FinnotechError, type BillDetail } from "./finnotech";

const KIND_FA: Record<string, string> = {
  electricity: "برق",
  gas: "گاز",
  water: "آب",
  tel: "تلفن",
  mobile: "موبایل",
};

export function renderBillSummary(bill: {
  utilityType: string;
  amount: number;
  term: string | null;
  details: Record<string, unknown>;
}): string {
  const kind = KIND_FA[bill.utilityType] ?? "قبض";
  const details = bill.details ?? {};
  const amounts = (details.amounts ?? {}) as Record<string, unknown>;
  const periodCost = amounts.period != null ? Number(amounts.period) : null;
  const headline = periodCost != null && Number.isFinite(periodCost) ? periodCost : bill.amount;
  const lines = [`📄 قبض ${kind}`, `مبلغ این دوره: ${fmtAmountRial(headline)}`];
  const debt = amounts.previousDebt != null ? Number(amounts.previousDebt) : null;
  if (debt && debt > 0) {
    lines.push(`بدهی قبلی: ${fmtAmountRial(debt)}`);
    const payable = amounts.payable != null ? Number(amounts.payable) : null;
    if (payable) lines.push(`قابل پرداخت: ${fmtAmountRial(payable)}`);
  }
  if (bill.term) lines.push(`دوره: ${bill.term}`);
  const total = ((details.consumption ?? {}) as Record<string, unknown>).total;
  if (total != null) lines.push(`مصرف دوره: ${fmtKwh(Number(total))} کیلووات‌ساعت`);
  const due = details.dueDate as string | undefined;
  if (due) lines.push(`مهلت پرداخت: ${due}`);
  return lines.join("\n");
}

function clientFor(env_ = env): Pick<FinnotechClient, "inquireBill"> {
  const c = env_.finnotech();
  if (c.clientId && c.clientSecret && c.nationalId) return new FinnotechClient();
  // Dev/preview without Finnotech credentials: deterministic stub keeps the flow usable.
  return new FakeFinnotechClient();
}

async function captureNumbers(input: {
  text?: string;
  imageBytes?: Buffer;
  pdfBytes?: Buffer;
}): Promise<BillNumbers | null> {
  if (input.pdfBytes) return extractFromPdf(input.pdfBytes);
  if (input.imageBytes) return extractFromImage(input.imageBytes);
  if (input.text) {
    try {
      return parseBillNumbers(input.text);
    } catch {
      return null;
    }
  }
  return null;
}

export interface CaptureOk {
  ok: true;
  billId: string; // db row id
  summary: string;
  isNew: boolean;
}
export interface CaptureErr {
  ok: false;
  error: string;
}
export type CaptureResult = CaptureOk | CaptureErr;

export async function captureBill(
  userId: string,
  input: { text?: string; imageBytes?: Buffer; pdfBytes?: Buffer },
  db: DB = getDb(),
  finnotech: Pick<FinnotechClient, "inquireBill"> = clientFor(),
): Promise<CaptureResult> {
  const bn = await captureNumbers(input);
  if (!bn) {
    return {
      ok: false,
      error:
        "نتونستم شناسه قبض رو پیدا کنم. 📸 عکس واضحی از بارکد قبض بفرست، یا خود شناسه (۱۳ رقم اول) رو تایپ کن.",
    };
  }

  let detail: BillDetail;
  try {
    detail = await finnotech.inquireBill(bn.billId);
  } catch (err) {
    const msg = err instanceof FinnotechError ? err.message : String(err);
    console.warn("[billing] inquiry failed:", msg);
    return { ok: false, error: "استعلام قبض الان ممکن نبود. چند لحظه بعد دوباره امتحان کن." };
  }

  // Same user + bill id + term ⇒ same bill: refresh it instead of duplicating.
  const existing = db
    .select()
    .from(schema.bills)
    .where(
      and(
        eq(schema.bills.userId, userId),
        eq(schema.bills.billId, detail.billId),
        detail.term ? eq(schema.bills.term, detail.term) : eq(schema.bills.billId, detail.billId),
      ),
    )
    .limit(1)
    .get();

  const consumption = toNumberOrNull((detail.details.consumption as Record<string, unknown> | undefined)?.total);
  if (existing) {
    db.update(schema.bills)
      .set({
        payId: detail.payId,
        amount: detail.amount,
        dueDate: detail.dueDate,
        consumption,
        details: JSON.stringify(detail.details),
      })
      .where(eq(schema.bills.id, existing.id))
      .run();
    const row = { ...existing, details: detail.details, amount: detail.amount };
    return { ok: true, billId: existing.id, summary: renderBillSummary(row), isNew: false };
  }

  const id = randomUUID();
  db.insert(schema.bills)
    .values({
      id,
      userId,
      billId: detail.billId,
      payId: detail.payId,
      utilityType: detail.utilityType,
      amount: detail.amount,
      term: detail.term,
      dueDate: detail.dueDate,
      consumption,
      details: JSON.stringify(detail.details),
      createdAt: now(),
    })
    .run();
  return {
    ok: true,
    billId: id,
    summary: renderBillSummary({
      utilityType: detail.utilityType,
      amount: detail.amount,
      term: detail.term,
      details: detail.details,
    }),
    isNew: true,
  };
}

/** Most recent prior bill of the same subscription (user+billId) before `beforeCreatedAt`. */
export function priorBill(
  db: DB,
  userId: string,
  billId: string,
  beforeCreatedAt: number,
): typeof schema.bills.$inferSelect | undefined {
  return db
    .select()
    .from(schema.bills)
    .where(
      and(
        eq(schema.bills.userId, userId),
        eq(schema.bills.billId, billId),
        lt(schema.bills.createdAt, beforeCreatedAt),
      ),
    )
    .orderBy(desc(schema.bills.createdAt))
    .limit(1)
    .get();
}

function toNumberOrNull(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}
