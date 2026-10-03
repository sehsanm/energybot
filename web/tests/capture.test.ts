import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb, schema } from "@/lib/db";
import { captureBill, priorBill } from "@/lib/billing/service";
import { FakeFinnotechClient, FinnotechError, type BillDetail } from "@/lib/billing/finnotech";
import { resolveUser } from "@/lib/bot/identity";

const VALID_ID = "9706459904126"; // electricity, from the fixture barcode

function detail(overrides: Partial<BillDetail> = {}): BillDetail {
  return {
    billId: VALID_ID,
    payId: "0001727250230",
    amount: 15_200_000,
    utilityType: "electricity",
    term: "1404/03",
    dueDate: "1404/04/15",
    raw: {},
    details: {
      amounts: { period: 14_000_000, payable: 15_200_000 },
      consumption: { total: 600 },
    },
    ...overrides,
  };
}

describe("captureBill", () => {
  it("returns a friendly Persian error when the id is invalid", async () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "1" }, db);
    const res = await captureBill(user.id, { text: "not a bill" }, db, new FakeFinnotechClient());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("شناسه قبض");
  });

  it("captures a typed bill id: stores the row and renders the summary", async () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "1" }, db);
    const res = await captureBill(user.id, { text: VALID_ID }, db, new FakeFinnotechClient(detail()));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.isNew).toBe(true);
      expect(res.summary).toContain("📄 قبض برق");
      expect(res.summary).toContain("۱,۴۰۰,۰۰۰ تومان"); // headline = period amount, not payable
    }
    const rows = db.select().from(schema.bills).where(eq(schema.bills.userId, user.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].billId).toBe(VALID_ID);
    expect(rows[0].consumption).toBe(600);
  });

  it("updates instead of duplicating on re-capture of the same bill+term", async () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "1" }, db);
    const first = await captureBill(user.id, { text: VALID_ID }, db, new FakeFinnotechClient(detail()));
    const second = await captureBill(user.id, { text: VALID_ID }, db, new FakeFinnotechClient(detail({ amount: 16_000_000 })));
    expect(first.ok && second.ok).toBe(true);
    if (second.ok) expect(second.isNew).toBe(false);
    const rows = db.select().from(schema.bills).where(eq(schema.bills.userId, user.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(16_000_000);
  });

  it("keeps bills of different terms separate", async () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "1" }, db);
    await captureBill(user.id, { text: VALID_ID }, db, new FakeFinnotechClient(detail({ term: "1404/03" })));
    await captureBill(user.id, { text: VALID_ID }, db, new FakeFinnotechClient(detail({ term: "1404/04" })));
    expect(db.select().from(schema.bills).all()).toHaveLength(2);
  });

  it("returns a friendly error when the inquiry fails", async () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "1" }, db);
    const res = await captureBill(user.id, { text: VALID_ID }, db, new FakeFinnotechClient(undefined, new FinnotechError("boom")));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("استعلام");
  });
});

describe("priorBill", () => {
  it("finds the closest previous bill of the same subscription", () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "1" }, db);
    const t0 = 1_700_000_000_000;
    for (const [i, term] of ["1404/02", "1404/03", "1404/04"].entries()) {
      db.insert(schema.bills)
        .values({
          id: `row-${i}`,
          userId: user.id,
          billId: VALID_ID,
          utilityType: "electricity",
          amount: 1,
          term,
          createdAt: t0 + i * 1000, // deterministic spacing (same-ms captures would tie)
        })
        .run();
    }
    const prev = priorBill(db, user.id, VALID_ID, t0 + 2000);
    expect(prev).toBeDefined();
    expect(prev!.term).toBe("1404/03");
    // A different bill id has no history.
    expect(priorBill(db, user.id, "1234567890125", Date.now())).toBeUndefined();
  });
});
