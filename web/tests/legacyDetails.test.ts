import { describe, expect, it } from "vitest";
import { camelizeLegacyDetails, legacyStoredAmount } from "@/lib/billing/legacyDetails";

const LEGACY_DETAILS = {
  company: "برق توزیع",
  customer_type: "Domestic",
  tariff: "معماری",
  phase: 1,
  amper: 25,
  period: { year: 1404, number: 3, days: 31 },
  reading: { previous_date: "1404/01/10", current_date: "1404/02/10" },
  due_date: "1404/04/15",
  consumption: { normal: 480, peak: 60, total: 600, unit: "kWh" },
  amounts: {
    period: 1_400_000,
    previous_debt: 120_000,
    payable: 1_520_000,
    pay_amount: 1_520_000,
    energy: 1_300_000,
  },
};

describe("camelizeLegacyDetails", () => {
  it("maps legacy snake_case keys to the camelCase shape this app reads", () => {
    const d = camelizeLegacyDetails(LEGACY_DETAILS);
    expect(d.customerType).toBe("Domestic");
    expect(d.dueDate).toBe("1404/04/15");
    expect((d.reading as any).currentDate).toBe("1404/02/10");
    expect((d.reading as any).previousDate).toBe("1404/01/10");
    expect((d.amounts as any).previousDebt).toBe(120_000);
    expect((d.amounts as any).payAmount).toBe(1_520_000);
    // already-camelCase keys survive untouched
    expect((d.amounts as any).period).toBe(1_400_000);
    expect(d.consumption).toEqual(LEGACY_DETAILS.consumption);
  });

  it("maps raw_info → rawInfo (gas/water passthrough shape)", () => {
    const d = camelizeLegacyDetails({ raw_info: { CompanyName: "گاز" } });
    expect((d as any).rawInfo).toEqual({ CompanyName: "گاز" });
  });

  it("tolerates null/absent trees", () => {
    expect(camelizeLegacyDetails(null)).toEqual({});
    expect(camelizeLegacyDetails({})).toEqual({});
    expect(camelizeLegacyDetails({ amounts: null, reading: undefined })).toEqual({});
  });
});

describe("legacyStoredAmount", () => {
  it("prefers the period cost like the legacy repository did", () => {
    expect(legacyStoredAmount(LEGACY_DETAILS, 1_520_000)).toBe(1_400_000);
  });
  it("falls back to the Finnotech amount without period data", () => {
    expect(legacyStoredAmount({}, 1_520_000)).toBe(1_520_000);
    expect(legacyStoredAmount({ amounts: { period: null } }, 999)).toBe(999);
  });
});
