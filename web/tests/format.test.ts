import { describe, expect, it } from "vitest";
import { fmtAmountRial, fmtKwh, toPersianDigits } from "@/lib/format";

describe("format", () => {
  it("converts ASCII digits to Persian", () => {
    expect(toPersianDigits("1404/03")).toBe("۱۴۰۴/۰۳");
    expect(toPersianDigits(600)).toBe("۶۰۰");
  });

  it("formats rial amounts as toman with separators", () => {
    expect(fmtAmountRial(15_200_000)).toBe("۱٬۵۲۰٬۰۰۰ تومان");
    expect(fmtAmountRial(0)).toBe("۰ تومان");
  });

  it("formats kWh with the Persian decimal separator", () => {
    expect(fmtKwh(600)).toBe("۶۰۰");
    expect(fmtKwh(600.5)).toBe("۶۰۰٫۵");
    expect(fmtKwh(1234.25)).toBe("۱٬۲۳۴٫۳");
  });
});
