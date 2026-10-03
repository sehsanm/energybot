import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestDb } from "@/lib/db";
import { bootstrapAdmin, findAdminByEmail } from "@/lib/admin/bootstrap";
import { hashPassword, verifyPassword } from "@/lib/admin/password";

afterEach(() => vi.unstubAllEnvs());

describe("bootstrapAdmin", () => {
  it("creates the first admin from env, verifies passwords, and never duplicates", async () => {
    vi.stubEnv("ADMIN_BOOTSTRAP_EMAIL", "Admin@Test.Local");
    vi.stubEnv("ADMIN_BOOTSTRAP_PASSWORD", "secret-123");
    const db = makeTestDb();
    await bootstrapAdmin(db);
    await bootstrapAdmin(db); // second start — no-op

    const found = await findAdminByEmail("admin@test.local", db); // lowercased lookup
    expect(found).toBeTruthy();
    expect(await verifyPassword(found!.passwordHash, "secret-123")).toBe(true);
    expect(await verifyPassword(found!.passwordHash, "wrong")).toBe(false);
    expect((await findAdminByEmail("nobody@test.local", db)) ?? null).toBeNull();
  });

  it("skips bootstrapping without a password", async () => {
    vi.stubEnv("ADMIN_BOOTSTRAP_PASSWORD", "");
    const db = makeTestDb();
    await bootstrapAdmin(db);
    expect(await findAdminByEmail("admin@energybot.local", db)).toBeUndefined();
  });
});

describe("argon2 password round-trip", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("پسورد");
    expect(h).not.toContain("پسورد");
    expect(await verifyPassword(h, "پسورد")).toBe(true);
    expect(await verifyPassword(h, "پسورد ")).toBe(false);
    // malformed hash doesn't throw
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});
