import { describe, it, expect } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import { applyProfileUpdate, readProfile } from "@/lib/profile/apiUpdate";
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
  it("normalizes Persian-digit strings in numeric fields before storing", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    applyProfileUpdate(db, uid, { occupants: "۳" });
    const h = JSON.parse(getProfileRow(db, uid)!.household);
    expect(h.occupants).toBe(3);
  });
  it("empty string on a numeric field removes the stored key without clobbering siblings", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    applyProfileUpdate(db, uid, { occupants: 3, area_m2: 75 });
    applyProfileUpdate(db, uid, { area_m2: "" });
    const h = JSON.parse(getProfileRow(db, uid)!.household);
    expect("area_m2" in h).toBe(false); // key deleted, not kept behind «ذخیره شد»
    expect(h.occupants).toBe(3);
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

describe("readProfile", () => {
  it("returns empty household/behaviour and no goals for a user with no profile row", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    const p = readProfile(db, uid);
    expect(p.household).toEqual({});
    expect(p.behaviour).toEqual({});
    expect(p.goals).toEqual([]);
  });

  it("returns behaviour so the wizard resume draft sees motivations/service_prefs (spec §6)", () => {
    const db = makeTestDb();
    const uid = seedUser(db);
    applyProfileUpdate(db, uid, {
      city: "تهران",
      behaviour: { motivations: ["reduce_bill"], service_prefs: ["weekly_summary"] },
    });
    const p = readProfile(db, uid);
    expect(p.household.city).toBe("تهران");
    expect(p.behaviour.motivations).toEqual(["reduce_bill"]);
    expect(p.behaviour.service_prefs).toEqual(["weekly_summary"]);
    expect(p.goals).toEqual([]);
  });
});
