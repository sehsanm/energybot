import { describe, it, expect, vi } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import { markOnboarded, isOnboarded, markOnboardingSkipped, isOnboardingSkipped } from "@/lib/onboarding/complete";
import { getProfileRow, updateProfileParts } from "@/lib/profile/parts";
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

describe("markOnboardingSkipped", () => {
  it("persists skippedAt exactly once (idempotent) without completing", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    markOnboardingSkipped(db, uid);
    const first = JSON.parse(getProfileRow(db, uid)!.behaviour).onboarding.skippedAt as number;
    expect(first).toBeGreaterThan(0);
    expect(isOnboarded(getProfileRow(db, uid))).toBe(false); // a skip is not a completion
    markOnboardingSkipped(db, uid);
    expect(JSON.parse(getProfileRow(db, uid)!.behaviour).onboarding.skippedAt).toBe(first); // first write wins
  });

  it("never overrides a completion, and completing after a skip supersedes it", () => {
    const done = makeTestDb();
    const doneUid = seedUser(done);
    markOnboarded(done, doneUid, "app");
    markOnboardingSkipped(done, doneUid); // no-op: completed users never "skip"
    expect(JSON.parse(getProfileRow(done, doneUid)!.behaviour).onboarding.skippedAt).toBeUndefined();

    const later = makeTestDb();
    const laterUid = seedUser(later);
    markOnboardingSkipped(later, laterUid);
    markOnboarded(later, laterUid, "app");
    const onb = JSON.parse(getProfileRow(later, laterUid)!.behaviour).onboarding;
    expect(onb.completed).toBe(true); // completion wins…
    expect(onb.skippedAt).toBeUndefined(); // …and replaces the skip wholesale
    expect(isOnboardingSkipped(getProfileRow(later, laterUid))).toBe(false);
    expect(isOnboarded(getProfileRow(later, laterUid))).toBe(true);
  });

  it("emits no event", () => {
    const events: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => events.push(a));
    const db = makeTestDb();
    const uid = seedUser(db);
    markOnboardingSkipped(db, uid);
    expect(events.filter((e) => String(e[0]).includes("onboarding"))).toHaveLength(0);
    spy.mockRestore();
  });
});

describe("isOnboardingSkipped (the /api/me `skipped` derivation)", () => {
  it("derives skipped from the profile row, orthogonal to completion", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    expect(isOnboardingSkipped(getProfileRow(db, uid))).toBe(false); // no row at all
    updateProfileParts(db, uid, { behaviour: { onboarding: { skippedAt: 1 } } });
    expect(isOnboardingSkipped(getProfileRow(db, uid))).toBe(true);
    expect(isOnboarded(getProfileRow(db, uid))).toBe(false); // skipped ≠ onboarded
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
