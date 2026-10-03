import { describe, expect, it } from "vitest";
import {
  InvalidBillNumbersError,
  isValidBillId,
  parseBillNumbers,
  utilityTypeFor,
  normalizeFaDigits,
} from "@/lib/billing/billNumbers";

describe("isValidBillId", () => {
  it("accepts ids with a valid mod-11 check digit", () => {
    expect(isValidBillId("7742890001027")).toBe(true);
    expect(isValidBillId("1234567890125")).toBe(true);
  });
  it("rejects bad checksums, wrong lengths and all-zeros", () => {
    expect(isValidBillId("7742890001028")).toBe(false);
    expect(isValidBillId("123")).toBe(false);
    expect(isValidBillId("0000000000000")).toBe(false);
  });
});

describe("utilityTypeFor", () => {
  it("maps the service-type digit (2nd from last)", () => {
    expect(utilityTypeFor("7742890001027")).toBe("electricity"); // ...2|7
    expect(utilityTypeFor("1234567890133")).toBe("gas"); // ...3|3
    expect(utilityTypeFor("1234567890111")).toBe("water"); // ...1|1
  });
});

describe("parseBillNumbers", () => {
  it("parses a single bill id without pay id", () => {
    const bn = parseBillNumbers("7742890001027");
    expect(bn).toEqual({ billId: "7742890001027", payId: null, utilityType: "electricity" });
  });
  it("parses bill id + pay id", () => {
    const bn = parseBillNumbers("7742890001027 1234567890125");
    expect(bn.payId).toBe("1234567890125");
  });
  it("splits a 26-digit barcode payload", () => {
    const bn = parseBillNumbers("7742890001027123456789012 5".replace(/\s/g, "").slice(0, 13) + "1234567890125");
    expect(bn.billId).toBe("7742890001027");
    expect(bn.payId).toBe("1234567890125");
  });
  it("normalizes Persian/Arabic digits", () => {
    expect(normalizeFaDigits("۷۷۴۲۸۹")).toBe("774289");
    expect(parseBillNumbers("۷۷۴۲۸۹۰۰۰۱۰۲۷").billId).toBe("7742890001027");
  });
  it("throws on garbage", () => {
    expect(() => parseBillNumbers("hello")).toThrow(InvalidBillNumbersError);
    expect(() => parseBillNumbers("7742890001028")).toThrow(InvalidBillNumbersError);
  });
});
