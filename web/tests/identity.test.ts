import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, schema } from "@/lib/db";
import { resolveUser } from "@/lib/bot/identity";

describe("resolveUser", () => {
  it("creates user + identity on first contact and reuses them after", () => {
    const db = makeTestDb();
    const first = resolveUser("bale", { externalId: "111", displayName: "علی" }, db);
    expect(first.user.displayName).toBe("علی");
    expect(first.identity.channel).toBe("bale");
    // Profile row is provisioned too.
    expect(db.select().from(schema.profiles).where(eq(schema.profiles.userId, first.user.id)).get()).toBeTruthy();

    const again = resolveUser("bale", { externalId: "111", displayName: "علی‌رضا" }, db);
    expect(again.user.id).toBe(first.user.id);
    const users = db.select().from(schema.users).all();
    expect(users).toHaveLength(1);

    // A Telegram contact gets a separate account (per-channel identity model).
    const tg = resolveUser("telegram", { externalId: "111", displayName: "Ali" }, db);
    expect(tg.user.id).not.toBe(first.user.id);
    expect(db.select().from(schema.userIdentities).all()).toHaveLength(2);
  });

  it("refreshes username and last-seen on contact", () => {
    const db = makeTestDb();
    resolveUser("bale", { externalId: "222", displayName: null, username: null }, db);
    const again = resolveUser("bale", { externalId: "222", username: "newname" }, db);
    expect(again.identity.username).toBe("newname");
    expect(again.identity.lastSeenAt).toBeGreaterThan(0);
  });
});
