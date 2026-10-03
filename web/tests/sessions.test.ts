import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, now, schema } from "@/lib/db";
import { createSession, csrfOk, deleteSession, getSession, sessionIdFor, signCsrf } from "@/lib/auth/sessions";
import { resolveUser } from "@/lib/bot/identity";
import { bootstrapAdmin } from "@/lib/admin/bootstrap";

// Sessions carry real FKs — provision a genuine user + admin first.
async function seed(db: ReturnType<typeof makeTestDb>) {
  const { user } = resolveUser("bale", { externalId: "1" }, db);
  const adminId = "a1";
  db.insert(schema.adminUsers)
    .values({ id: adminId, email: "a@test.local", passwordHash: "x", createdAt: now() })
    .run();
  return { userId: user.id, adminId };
}

describe("sessions", () => {
  it("creates and resolves a user session; cookie value is not the id", async () => {
    const db = makeTestDb();
    const { userId } = await seed(db);
    const { cookieValue, sessionId } = createSession("user", { userId }, db);
    expect(sessionIdFor(cookieValue)).toBe(sessionId);
    const got = getSession("user", cookieValue, db);
    expect(got?.userId).toBe(userId);
    const rows = db.select().from(schema.sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(sessionId); // stored id is the hash, not the cookie
  });

  it("separates user and admin kinds", async () => {
    const db = makeTestDb();
    const { userId, adminId } = await seed(db);
    const user = createSession("user", { userId }, db);
    const admin = createSession("admin", { adminId }, db);
    expect(getSession("admin", user.cookieValue, db)).toBeNull();
    expect(getSession("user", admin.cookieValue, db)).toBeNull();
    expect(getSession("user", user.cookieValue, db)?.userId).toBe(userId);
    expect(getSession("admin", admin.cookieValue, db)?.adminId).toBe(adminId);
  });

  it("rejects expired sessions", async () => {
    const db = makeTestDb();
    const { userId } = await seed(db);
    const { cookieValue, sessionId } = createSession("user", { userId }, db);
    db.update(schema.sessions).set({ expiresAt: Date.now() - 1 }).where(eq(schema.sessions.id, sessionId)).run();
    expect(getSession("user", cookieValue, db)).toBeNull();
  });

  it("deletes sessions on logout", async () => {
    const db = makeTestDb();
    const { userId } = await seed(db);
    const { cookieValue } = createSession("user", { userId }, db);
    deleteSession(cookieValue, db);
    expect(getSession("user", cookieValue, db)).toBeNull();
    expect(db.select().from(schema.sessions).all()).toHaveLength(0);
  });

  it("csrf double-submit: header must equal HMAC(secret, sessionId)", async () => {
    const db = makeTestDb();
    const { userId } = await seed(db);
    const { sessionId } = createSession("user", { userId }, db);
    const token = signCsrf(sessionId);
    expect(csrfOk(sessionId, token)).toBe(true);
    expect(csrfOk(sessionId, "wrong")).toBe(false);
    expect(csrfOk(sessionId, null)).toBe(false);
    expect(csrfOk(undefined, token)).toBe(false);
  });
});
