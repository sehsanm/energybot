import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFromImage, extractFromPdf } from "@/lib/billing/extract";
import { isValidBillId } from "@/lib/billing/billNumbers";

const FIXTURES = path.resolve(__dirname, "fixtures");

// These fixtures are real Iranian bill samples carried over from the legacy
// Python test suite — they prove the zxing port behaves like pyzbar did.
describe("extractFromImage", () => {
  it("reads the bill barcode from a photographed bill", { timeout: 30_000 }, async () => {
    const bytes = readFileSync(path.join(FIXTURES, "bill_barcode_sample.png"));
    const bn = await extractFromImage(bytes);
    expect(bn).not.toBeNull();
    expect(isValidBillId(bn!.billId)).toBe(true);
    expect(bn!.utilityType).toMatch(/^(electricity|gas|water)$/);
  });
});

describe("extractFromPdf", () => {
  it("reads the bill barcode from a PDF bill (300 DPI rasterize)", { timeout: 60_000 }, async () => {
    const bytes = readFileSync(path.join(FIXTURES, "bill_barcode_sample.pdf"));
    const bn = await extractFromPdf(bytes);
    expect(bn).not.toBeNull();
    expect(isValidBillId(bn!.billId)).toBe(true);
  });
});
