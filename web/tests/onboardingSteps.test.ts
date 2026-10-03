import { describe, it, expect } from "vitest";
import {
  draftFromProfile,
  isStepValid,
  nextIncompleteStep,
  mergeStepBodies,
  ONBOARDING_STEPS,
  stepBody,
} from "@/lib/onboarding/steps";

const FULL = {
  city: "تهران", home_type: "آپارتمان", occupants: 3, area_m2: 75,
  heating_type: "پکیج گازی", cooling_type: "کولر گازی", main_concern: "both" as const,
  motivations: ["reduce_bill"], service_prefs: ["daily_reminder"],
};

describe("draftFromProfile", () => {
  it("maps household/behaviour into a draft and coerces legacy string numbers", () => {
    const draft = draftFromProfile({
      household: { city: "شیراز", home_type: "آپارتمان", occupants: "3", area_m2: "75" },
      behaviour: { motivations: ["help_country"], service_prefs: [] },
    });
    expect(draft.city).toBe("شیراز");
    expect(draft.occupants).toBe(3);
    expect(draft.area_m2).toBe(75);
    expect(draft.motivations).toEqual(["help_country"]);
  });

  it("coerces Persian-digit strings so legacy «۳» rows resume instead of re-asking", () => {
    const draft = draftFromProfile({ household: { occupants: "۳", area_m2: "۱۲۵" } });
    expect(draft.occupants).toBe(3);
    expect(draft.area_m2).toBe(125);
  });
});

describe("isStepValid", () => {
  it("requires every field of a step; toolbox and first_bill are always valid", () => {
    expect(isStepValid("home", { city: "تهران" })).toBe(false);
    expect(isStepValid("home", { city: "تهران", home_type: "آپارتمان" })).toBe(true);
    expect(isStepValid("occupants", { occupants: 3 })).toBe(false);
    expect(isStepValid("occupants", { occupants: 3, area_m2: 75 })).toBe(true);
    expect(isStepValid("occupants", { occupants: 9, area_m2: 75 })).toBe(false);
    expect(isStepValid("motivations", {})).toBe(false);
    expect(isStepValid("motivations", { motivations: ["reduce_bill"] })).toBe(true);
    expect(isStepValid("first_bill", {})).toBe(true);
    expect(isStepValid("toolbox", {})).toBe(true);
  });
});

describe("nextIncompleteStep", () => {
  it("walks steps in order and stops at the first incomplete one", () => {
    expect(nextIncompleteStep({})).toBe("home");
    expect(nextIncompleteStep({ city: "تهران", home_type: "آپارتمان" })).toBe("occupants");
    expect(nextIncompleteStep({ ...FULL })).toBe("toolbox"); // everything valid → last step
  });
  it("step list matches the spec order", () => {
    expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual([
      "welcome", "home", "occupants", "systems", "motivations", "first_bill", "toolbox",
    ]);
  });
});

describe("stepBody (the PUT body each step commits on «ادامه»)", () => {
  it("carries only the step's own fields; non-saving steps return null", () => {
    expect(stepBody("welcome", FULL)).toBeNull();
    expect(stepBody("first_bill", FULL)).toBeNull();
    expect(stepBody("toolbox", FULL)).toBeNull(); // saved by «تأیید», not per-step
    expect(stepBody("home", FULL)).toEqual({ city: "تهران", home_type: "آپارتمان" });
    expect(stepBody("occupants", FULL)).toEqual({ occupants: 3, area_m2: 75 });
    expect(stepBody("systems", FULL)).toEqual({
      heating_type: "پکیج گازی",
      cooling_type: "کولر گازی",
      main_concern: "both",
    });
    expect(stepBody("motivations", FULL)).toEqual({
      behaviour: { motivations: ["reduce_bill"] },
    });
  });

  it("trims the city before saving", () => {
    expect(stepBody("home", { city: "  تهران  ", home_type: "آپارتمان" })).toEqual({
      city: "تهران",
      home_type: "آپارتمان",
    });
  });
});

describe("mergeStepBodies (retry queue: failed saves re-send with the next one)", () => {
  it("merges queued failures with the newer save so no field is lost", () => {
    const home = { city: "تهران", home_type: "آپارتمان" };
    const occupants = { occupants: 3, area_m2: 75 };
    expect(mergeStepBodies([home, occupants])).toEqual({ ...home, ...occupants });
  });

  it("merges behaviour sub-objects per-key instead of clobbering siblings", () => {
    expect(
      mergeStepBodies([
        { behaviour: { motivations: ["reduce_bill"] } },
        { behaviour: { service_prefs: ["daily_reminder"] } },
      ]),
    ).toEqual({ behaviour: { motivations: ["reduce_bill"], service_prefs: ["daily_reminder"] } });
  });

  it("later bodies win for the same key — a re-tapped step supersedes its stale queue entry", () => {
    expect(mergeStepBodies([{ city: "شیراز" }, { city: "تهران" }])).toEqual({ city: "تهران" });
    expect(
      mergeStepBodies([
        { behaviour: { motivations: ["help_country"] } },
        { behaviour: { motivations: ["reduce_bill"] } },
      ]),
    ).toEqual({ behaviour: { motivations: ["reduce_bill"] } });
  });

  it("empty queue merges to an empty body", () => {
    expect(mergeStepBodies([])).toEqual({});
  });
});
