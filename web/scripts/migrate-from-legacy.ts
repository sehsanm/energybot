// One-off migration: legacy Postgres (Python energybot) → new SQLite.
//
// Usage:
//   LEGACY_DATABASE_URL=postgres://... npm run migrate:legacy [-- --dry-run] [--messages]
//
// Moves: users (+ bale identities), profiles, bills (details/suggestions),
// and optionally recent messages (only with --messages). Idempotent per
// legacy row id — re-running skips already-migrated users/bills.

import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { getDb, now, schema } from "../src/lib/db";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const WITH_MESSAGES = argv.includes("--messages");
const LEGACY_URL = process.env.LEGACY_DATABASE_URL;
if (!LEGACY_URL) {
  console.error("Set LEGACY_DATABASE_URL (postgres://user:pass@host:5432/energybot)");
  process.exit(1);
}

async function main(): Promise<void> {
  const db = getDb();
  const pg = new Client({ connectionString: LEGACY_URL });
  await pg.connect();
  console.log(`connected to legacy db${DRY_RUN ? " (dry run)" : ""}`);

  const users = (
    await pg.query(
      `SELECT u.id::text, u.bale_user_id::text, u.display_name, u.language, u.is_blocked,
              u.created_at, u.last_seen_at
       FROM users u WHERE u.deleted_at IS NULL ORDER BY u.created_at`,
    )
  ).rows;

  let migratedUsers = 0;
  let skippedUsers = 0;
  let migratedBills = 0;

  for (const u of users) {
    const existing = db.select().from(schema.users).where(eq(schema.users.legacyId, u.id)).get();
    if (existing) {
      skippedUsers++;
      continue;
    }
    const userId = randomUUID();
    const ts = Date.parse(u.created_at) || now();
    if (!DRY_RUN) {
      db.insert(schema.users)
        .values({
          id: userId,
          displayName: u.display_name,
          language: u.language ?? "fa",
          isBlocked: !!u.is_blocked,
          createdAt: ts,
          lastSeenAt: u.last_seen_at ? Date.parse(u.last_seen_at) : ts,
          legacyId: u.id,
        })
        .run();
      db.insert(schema.userIdentities)
        .values({
          id: randomUUID(),
          userId,
          channel: "bale",
          externalId: String(u.bale_user_id),
          username: null,
          payload: "{}",
          createdAt: ts,
          lastSeenAt: ts,
        })
        .run();

      const profile = (
        await pg.query(
          `SELECT household, behaviour, goals FROM profiles WHERE user_id = $1 AND deleted_at IS NULL`,
          [u.id],
        )
      ).rows[0];
      db.insert(schema.profiles)
        .values({
          userId,
          household: JSON.stringify(profile?.household ?? {}),
          behaviour: JSON.stringify(profile?.behaviour ?? {}),
          goals: JSON.stringify(profile?.goals ?? []),
          updatedAt: now(),
        })
        .run();

      const bills = (
        await pg.query(
          `SELECT b.id::text, b.bill_id::text, b.pay_id::text, b.utility_type, b.amount::int8 as amount,
                  b.term, b.due_date::text, b.consumption, b.details, b.suggestions, b.inquired_at
           FROM bills b WHERE b.user_id = $1 ORDER BY b.inquired_at`,
          [u.id],
        )
      ).rows;
      for (const b of bills) {
        const suggestions = b.suggestions
          ? JSON.stringify({
              generatedAt: Date.parse(b.suggestions.generated_at ?? "") || now(),
              intro: b.suggestions.intro ?? "",
              tips: b.suggestions.tips ?? [],
              targets: b.suggestions.targets ?? [],
              model: b.suggestions.model ?? "legacy",
            })
          : null;
        db.insert(schema.bills)
          .values({
            id: randomUUID(),
            userId,
            billId: String(b.bill_id),
            payId: b.pay_id ? String(b.pay_id) : null,
            utilityType: b.utility_type,
            amount: Number(b.amount ?? 0),
            term: b.term,
            dueDate: b.due_date,
            consumption: b.consumption != null ? Number(b.consumption) : null,
            details: JSON.stringify(b.details ?? {}),
            suggestions,
            createdAt: Date.parse(b.inquired_at) || now(),
            legacyId: b.id,
          })
          .run();
        migratedBills++;
      }

      if (WITH_MESSAGES) {
        const messages = (
          await pg.query(
            `SELECT role, content, created_at FROM messages
             WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
            [u.id],
          )
        ).rows;
        for (const m of messages.reverse()) {
          db.insert(schema.messages)
            .values({
              userId,
              channel: "bale",
              role: m.role === "assistant" ? "bot" : m.role === "user" ? "user" : "bot",
              content: String(m.content ?? "").slice(0, 4000),
              createdAt: Date.parse(m.created_at) || now(),
            })
            .run();
        }
      }
    }
    migratedUsers++;
  }

  console.log(`users migrated: ${migratedUsers}, skipped (already present): ${skippedUsers}, bills: ${migratedBills}`);
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
