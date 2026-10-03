import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { renderBillSummary } from "@/lib/billing/service";
import { makeTestDb, schema } from "@/lib/db";
import { mintLoginToken, redeemLoginToken } from "@/lib/auth/loginTokens";
import { resolveUser } from "@/lib/bot/identity";

describe("renderBillSummary", () => {
  it("renders headline amount, debt, term and consumption in Persian", () => {
    const text = renderBillSummary({
      utilityType: "electricity",
      amount: 15_200_000,
      term: "1404/03",
      details: {
        amounts: { period: 14_000_000, previousDebt: 120_000, payable: 15_200_000 },
        consumption: { total: 600.5 },
        dueDate: "1404/04/15",
      },
    });
    expect(text).toContain("📄 قبض برق");
    expect(text).toContain("۱٬۴۰۰٬۰۰۰ تومان");
    expect(text).toContain("بدهی قبلی: ۱۲٬۰۰۰ تومان");
    expect(text).toContain("دوره: 1404/03");
    expect(text).toContain("۶۰۰٫۵ کیلووات‌ساعت");
  });
});

describe("login tokens", () => {
  it("mints single-use tokens that expire", async () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "333" }, db);
    const raw = await mintLoginToken(user.id, db);
    expect(redeemLoginToken(raw, db)).toBe(user.id);
    expect(redeemLoginToken(raw, db)).toBeNull(); // single use
    const raw2 = await mintLoginToken(user.id, db);
    expect(redeemLoginToken(raw2 + "x", db)).toBeNull();
  });

  it("rejects expired tokens even when unused", async () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "334" }, db);
    const raw = await mintLoginToken(user.id, db);
    const tokenHash = createHash("sha256").update(raw, "utf8").digest("hex");
    db.update(schema.loginTokens).set({ expiresAt: Date.now() - 1 }).where(eq(schema.loginTokens.tokenHash, tokenHash)).run();
    expect(redeemLoginToken(raw, db)).toBeNull();
  });
});
