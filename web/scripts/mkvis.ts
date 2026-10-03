// Visual-pass helper (dev only): ensures a user exists and prints a session cookie.
import { getDb, now, schema } from "../src/lib/db";
import { createSession } from "../src/lib/auth/sessions";
import { eq } from "drizzle-orm";

const db = getDb();
const NAME = "سارا تستی";
let u = db.select().from(schema.users).where(eq(schema.users.displayName, NAME)).get();
if (!u) {
  const id = crypto.randomUUID();
  db.insert(schema.users)
    .values({ id, displayName: NAME, language: "fa", createdAt: now(), lastSeenAt: now() })
    .run();
  u = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}
const s = createSession("user", { userId: u!.id });
console.log("COOKIE=" + s.cookieValue);
