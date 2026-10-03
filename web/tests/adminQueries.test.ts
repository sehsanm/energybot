import { describe, it, expect } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import { buildStats, listUsers } from "@/lib/admin/queries";

const DAY = 86_400_000;

function seed() {
  const db = makeTestDb();
  const t = now();
  const uid = "11111111-1111-4111-8111-111111111111";
  db.insert(schema.users)
    .values({ id: uid, displayName: "سارا تستی", language: "fa", createdAt: t - 10 * DAY, lastSeenAt: t })
    .run();
  db.insert(schema.userIdentities)
    .values({
      id: "22222222-2222-4222-8222-222222222222",
      channel: "bale",
      externalId: "1001",
      userId: uid,
      username: "sara",
      createdAt: t,
    })
    .run();
  // messages: 3 today, 1 yesterday, 2 three days ago, none else
  for (const [offset, ch] of [[0, "bale"], [0, "web"], [0, "telegram"], [1, "bale"], [3, "bale"], [3, "web"]] as const) {
    db.insert(schema.messages)
      .values({ userId: uid, channel: ch, role: "user", content: "m", createdAt: t - offset * DAY })
      .run();
  }
  return { db, t, uid };
}

describe("buildStats", () => {
  it("returns 7 zero-filled days, oldest→newest, summing to messages7d", () => {
    const { db } = seed();
    const s = buildStats(db);
    expect(s.messagesByDay).toHaveLength(7);
    // oldest→newest ordering
    const days = s.messagesByDay.map((d) => d.date);
    expect([...days].sort()).toEqual(days);
    // every day present even when empty
    expect(s.messagesByDay.every((d) => typeof d.n === "number")).toBe(true);
    expect(s.messagesByDay.reduce((a, d) => a + d.n, 0)).toBe(s.messages7d);
    // the seeded counts land on today's bucket (3) — today is the last entry
    expect(s.messagesByDay[6].n).toBe(3);
  });
});

describe("listUsers", () => {
  it("includes per-user message counts alongside bill counts", () => {
    const { db, uid } = seed();
    const users = listUsers(db, "");
    const u = users.find((x) => x.id === uid)!;
    expect(u).toBeTruthy();
    expect(u.messageCount).toBe(6);
    expect(u.billCount).toBe(0);
    expect(u.channels).toEqual(["bale"]);
  });
});
