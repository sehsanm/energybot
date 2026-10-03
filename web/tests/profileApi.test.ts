import { describe, it, expect } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import { applyProfileUpdate } from "@/lib/profile/apiUpdate";
import { getProfileRow } from "@/lib/profile/parts";

function seedUser(db: ReturnType<typeof makeTestDb>) {
  const uid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  db.insert(schema.users).values({ id: uid, displayName: "x", language: "fa", createdAt: now(), lastSeenAt: now() }).run();
  return uid;
}

describe("applyProfileUpdate", () => {
  it("stores numbers as numbers and strings as bounded strings", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    applyProfileUpdate(db, uid, { city: "تهران", occupants: 3, area_m2: 75 });
    const h = JSON.parse(getProfileRow(db, uid)!.household);
    expect(h.city).toBe("تهران");
    expect(h.occupants).toBe(3);
    expect(h.area_m2).toBe(75);
  });
  it("accepts only known behaviour keys and merges shallowly", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    applyProfileUpdate(db, uid, { behaviour: { motivations: ["reduce_bill"] } });
    applyProfileUpdate(db, uid, { behaviour: { service_prefs: ["daily_reminder"] } });
    const b = JSON.parse(getProfileRow(db, uid)!.behaviour);
    expect(b.motivations).toEqual(["reduce_bill"]);
    expect(b.service_prefs).toEqual(["daily_reminder"]);
  });
  it("rejects unknown behaviour keys", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    applyProfileUpdate(db, uid, { behaviour: { onboarding: { completed: true } } as never });
    const b = JSON.parse(getProfileRow(db, uid)!.behaviour);
    expect(b.onboarding).toBeUndefined(); // completion only via markOnboarded
  });
});
