// Creates the first admin account at startup if none exists (email/password
// from ADMIN_BOOTSTRAP_* env). Successor to the legacy admin_cli create-user.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword } from "./password";

export async function bootstrapAdmin(db: DB = getDb()): Promise<void> {
  const any = db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).limit(1).get();
  if (any) return;
  const { bootstrapEmail, bootstrapPassword } = env.admin();
  if (!bootstrapPassword) {
    console.warn("[admin] no admin exists and ADMIN_BOOTSTRAP_PASSWORD unset — admin login disabled");
    return;
  }
  db.insert(schema.adminUsers)
    .values({
      id: randomUUID(),
      email: bootstrapEmail.toLowerCase().trim(),
      passwordHash: await hashPassword(bootstrapPassword),
      createdAt: now(),
    })
    .run();
  console.info(`[admin] bootstrapped ${bootstrapEmail.toLowerCase().trim()}`);
}

export async function findAdminByEmail(email: string, db: DB = getDb()) {
  return db.select().from(schema.adminUsers).where(eq(schema.adminUsers.email, email.toLowerCase().trim())).get();
}
