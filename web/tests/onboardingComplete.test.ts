import { describe, it, expect, vi } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import { markOnboarded, isOnboarded } from "@/lib/onboarding/complete";
import { getProfileRow } from "@/lib/profile/parts";
import { emitAppEvent } from "@/lib/events";

function seedUser(db: ReturnType<typeof makeTestDb>) {
  const uid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  db.insert(schema.users).values({ id: uid, displayName: "x", language: "fa", createdAt: now(), lastSeenAt: now() }).run();
  return uid;
}

describe("markOnboarded", () => {
  it("sets the flag with source and completedAt exactly once (idempotent)", () => {
    const events: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => events.push(a));
    const db = makeTestDb();
    const uid = seedUser(db);
    const first = markOnboarded(db, uid, "app");
    const firstAt = JSON.parse(getProfileRow(db, uid)!.behaviour).onboarding.completedAt;
    const second = markOnboarded(db, uid, "bot");
    const after = JSON.parse(getProfileRow(db, uid)!.behaviour).onboarding;
    expect(first.alreadyCompleted).toBe(false);
    expect(second.alreadyCompleted).toBe(true);
    expect(after.source).toBe("app"); // first write wins
    expect(after.completedAt).toBe(firstAt);
    const emitted = events.filter((e) => String(e[0]).includes("onboarding_completed"));
    expect(emitted).toHaveLength(1); // one event, not two
    expect(isOnboarded(getProfileRow(db, uid))).toBe(true);
    vi.mocked(console.log).mockRestore();
  });

  it("isOnboarded is false for missing/absent flags", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    expect(isOnboarded(getProfileRow(db, uid))).toBe(false); // no row at all
  });
});

describe("emitAppEvent", () => {
  it("logs a structured line", () => {
    const calls: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => calls.push(a.join(" ")));
    emitAppEvent("onboarding_completed", { userId: "u1" });
    expect(calls[0]).toContain("onboarding_completed");
    expect(calls[0]).toContain("u1");
    spy.mockRestore();
  });
});
