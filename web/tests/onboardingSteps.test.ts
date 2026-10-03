import { describe, it, expect } from "vitest";
import { draftFromProfile, isStepValid, nextIncompleteStep, ONBOARDING_STEPS } from "@/lib/onboarding/steps";

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
