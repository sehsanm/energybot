import { describe, expect, it } from "vitest";
import {
  buildSuggestionContext,
  parseSuggestionsJson,
  renderSuggestions,
  targetsAsGoals,
  toNumber,
} from "@/lib/billing/suggestions";

const BILL = {
  utilityType: "electricity",
  amount: 15_200_000, // rial
  term: "1404/03",
  details: {
    consumption: { normal: 480, peak: 60, low: 40, friday: 20, total: 600 },
    amounts: { period: 14_000_000, energy: 13_000_000, tax: 800_000, subscription: 200_000 },
    period: { days: 31 },
    reading: { currentDate: "1404/02/10" },
    tariff: "معماری",
    phase: 1,
    amper: 25,
  },
};
const PREV = {
  utilityType: "electricity",
  amount: 12_000_000,
  term: "1404/02",
  details: { consumption: { total: 500 }, amounts: { period: 11_000_000 } },
};
const PROFILE = { household: { occupants: 4, area_m2: "100-150", city: "تهران" }, behaviour: {} };

describe("toNumber bucket coercion", () => {
  it("parses buckets like the legacy wizard produced", () => {
    expect(toNumber("<60")).toBe(60);
    expect(toNumber("100-150")).toBe(125);
    expect(toNumber("۵")).toBe(5);
    expect(toNumber(null)).toBeNull();
    expect(toNumber("نامشخص")).toBeNull();
  });
});

describe("buildSuggestionContext", () => {
  const c = buildSuggestionContext(BILL, PROFILE, PREV);
  it("converts rial amounts to toman", () => {
    expect(c.amountToman).toBe(1_400_000);
    expect(c.energyToman).toBe(1_300_000);
  });
  it("computes densities and daily rate", () => {
    expect(c.kwhPerDay).toBe(19.4);
    expect(c.kwhPerPerson).toBe(150);
    expect(c.kwhPerM2).toBe(4.8); // 600 / 125 (bucket midpoint)
  });
  it("computes bucket shares", () => {
    expect(c.peakPct).toBe(10);
    expect(c.normalPct).toBe(80);
  });
  it("derives season from the Jalali reading date", () => {
    expect(c.season).toBe("بهار"); // month 2
  });
  it("builds prev deltas", () => {
    expect(c.prev?.totalKwh).toBe(500);
    expect(c.prev?.deltaKwh).toBe(100);
    expect(c.prev?.deltaPct).toBe(20);
    expect(c.prev?.deltaToman).toBe(300_000);
  });
  it("handles missing profile/prev", () => {
    const c2 = buildSuggestionContext(BILL, null, null);
    expect(c2.kwhPerPerson).toBeNull();
    expect(c2.prev).toBeNull();
    expect(c2.household).toEqual({});
  });
});

describe("parseSuggestionsJson", () => {
  it("accepts valid JSON (with surrounding prose)", () => {
    const p = parseSuggestionsJson('بفرما: {"intro":"سلام","tips":["الف","ب"],"targets":[{"text":"هدف","metric":"total_kwh"}]} ممنون');
    expect(p?.intro).toBe("سلام");
    expect(p?.tips).toEqual(["الف", "ب"]);
    expect(p?.targets).toHaveLength(1);
  });
  it("rejects malformed payloads", () => {
    expect(parseSuggestionsJson("no json here")).toBeNull();
    expect(parseSuggestionsJson('{"intro": 5, "tips": [], "targets": []}')).toBeNull();
    expect(parseSuggestionsJson('{"intro":"ok", "tips": "notalist", "targets": []}')).toBeNull();
    expect(parseSuggestionsJson(null)).toBeNull();
  });
});

describe("renderSuggestions", () => {
  it("renders the Persian layout with tips and targets", () => {
    const text = renderSuggestions({
      intro: "مصرف این دوره بالاست.",
      tips: ["کولر را تنظیم کن"],
      targets: [{ text: "کاهش ۱۰٪", saving_kwh: 60, how: "بتنهしてみ" }],
    });
    expect(text).toContain("💡 پیشنهادها برای این قبض");
    expect(text).toContain("• کولر را تنظیم کن");
    expect(text).toContain("🎯 هدف‌ها");
    expect(text).toContain("چطور:");
  });
});

describe("targetsAsGoals", () => {
  it("maps targets onto goal records with a source marker", () => {
    const goals = targetsAsGoals([{ text: "کاهش مصرف", metric: "peak_kwh" }], "bill-row-id");
    expect(goals[0].source).toBe("bill_suggestion");
    expect(goals[0].billId).toBe("bill-row-id");
    expect(goals[0].id).toBeTruthy();
  });
});
