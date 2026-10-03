import { describe, it, expect } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import { updateProfileParts, getProfileRow } from "@/lib/profile/parts";

describe("updateProfileParts", () => {
  it("shallow-merges household and behaviour per top-level key, preserving siblings", () => {
    const db = makeTestDb();
    const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    db.insert(schema.users).values({ id: uid, displayName: "x", language: "fa", createdAt: now(), lastSeenAt: now() }).run();
    updateProfileParts(db, uid, { behaviour: { onb_step: "city" }, household: { city: "تهران" } });
    updateProfileParts(db, uid, { behaviour: { service_prefs: ["daily_reminder"] } });
    const row = getProfileRow(db, uid)!;
    const behaviour = JSON.parse(row.behaviour);
    expect(behaviour.service_prefs).toEqual(["daily_reminder"]);
    expect(behaviour.onb_step).toBe("city"); // sibling survived
    expect(JSON.parse(row.household).city).toBe("تهران");
  });

  it("numbers pass through unchanged (no string coercion)", () => {
    const db = makeTestDb();
    const uid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    db.insert(schema.users).values({ id: uid, displayName: "x", language: "fa", createdAt: now(), lastSeenAt: now() }).run();
    updateProfileParts(db, uid, { household: { occupants: 3, area_m2: 75 } });
    const household = JSON.parse(getProfileRow(db, uid)!.household);
    expect(household.occupants).toBe(3);
    expect(household.area_m2).toBe(75);
  });
});
