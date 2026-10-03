import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, now, schema } from "@/lib/db";
import { replaceGoalsForBill } from "@/lib/profile/goals";
import { resolveUser } from "@/lib/bot/identity";

function goalsOf(db: ReturnType<typeof makeTestDb>, userId: string): Record<string, unknown>[] {
  const row = db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get()!;
  return JSON.parse(row.goals);
}

describe("replaceGoalsForBill", () => {
  it("replaces same-bill goals on regeneration without duplicating", () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "1" }, db);
    // First generation for bill A, plus a manual goal and another bill's goals.
    replaceGoalsForBill(db, user.id, "A", [{ id: "g1", text: "کاهش ۱۰٪", source: "bill_suggestion", billId: "A" }]);
    replaceGoalsForBill(db, user.id, "B", [{ id: "g2", text: "کاهش ۵٪", source: "bill_suggestion", billId: "B" }]);
    db.update(schema.profiles)
      .set({ goals: JSON.stringify([...goalsOf(db, user.id), { id: "m1", text: "هدف دستی" }]), updatedAt: now() })
      .where(eq(schema.profiles.userId, user.id))
      .run();

    // Regenerate bill A twice — only A's goals swap, B and the manual goal stay.
    replaceGoalsForBill(db, user.id, "A", [{ id: "g3", text: "کاهش ۱۵٪", source: "bill_suggestion", billId: "A" }]);
    replaceGoalsForBill(db, user.id, "A", [{ id: "g4", text: "کاهش ۲۰٪", source: "bill_suggestion", billId: "A" }]);

    const goals = goalsOf(db, user.id);
    expect(goals).toHaveLength(3);
    expect(goals.map((g) => g.id).sort()).toEqual(["g2", "g4", "m1"]);
    expect(goals.find((g) => g.id === "g2")).toBeDefined();
  });

  it("creates the profile row if missing", () => {
    const db = makeTestDb();
    const { user } = resolveUser("bale", { externalId: "2" }, db);
    db.delete(schema.profiles).where(eq(schema.profiles.userId, user.id)).run();
    replaceGoalsForBill(db, user.id, "X", [{ id: "g", text: "هدف", source: "bill_suggestion", billId: "X" }]);
    expect(goalsOf(db, user.id)).toHaveLength(1);
  });
});
