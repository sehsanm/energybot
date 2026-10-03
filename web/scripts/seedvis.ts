// Visual-pass helper (dev only): add fake message history for chart screenshots.
import { getDb, now, schema } from "../src/lib/db";
import { eq } from "drizzle-orm";

const db = getDb();
const NAME = "سارا تستی";
const u = db.select().from(schema.users).where(eq(schema.users.displayName, NAME)).get();
if (!u) throw new Error("run mkvis.ts first");
const DAY = 86_400_000;
const t = now();
// pattern: 2,5,3,8,4,6,9 over the last 7 days
const counts = [2, 5, 3, 8, 4, 6, 9];
counts.forEach((n, i) => {
  for (let k = 0; k < n; k++) {
    db.insert(schema.messages)
      .values({
        userId: u.id,
        channel: k % 3 === 0 ? "telegram" : "bale",
        role: k % 2 === 0 ? "user" : "assistant",
        content: "visual seed",
        createdAt: t - (6 - i) * DAY + k * 60_000,
      })
      .run();
  }
});
console.log("seeded", counts.reduce((a, b) => a + b, 0), "messages");
