// Port of legacy src/energybot/billing/bill_numbers.py — Iranian bill ID rules.

const FA_DIGITS: Record<string, string> = {};
for (const [i, d] of Object.entries("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩")) FA_DIGITS[d] = i;

export interface BillNumbers {
  billId: string;
  payId: string | null;
  utilityType: string;
}

export function normalizeFaDigits(raw: string): string {
  return raw.replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] ?? d);
}

/** Iranian bill/pay-id check digit: weights cycle 2..7 over reversed digits, mod 11. */
function checkDigit(number: string): string {
  let s = 0;
  let w = 2;
  for (const ch of [...number].reverse()) {
    s += Number(ch) * w;
    w = w === 7 ? 2 : w + 1;
  }
  const r = s % 11;
  return r < 2 ? "0" : String(11 - r);
}

export function isValidBillId(billId: string): boolean {
  if (!/^\d{6,13}$/.test(billId)) return false;
  if (/^0+$/.test(billId)) return false;
  return checkDigit(billId.slice(0, -1)) === billId[billId.length - 1];
}

// Service type is the 2nd-from-last digit of the bill id (verified against real bills).
const SERVICE_TYPE_CODES: Record<string, string> = {
  "1": "water",
  "2": "electricity",
  "3": "gas",
  "4": "tel",
  "5": "mobile",
  "6": "municipality",
};

export function utilityTypeFor(billId: string): string {
  if (!/^\d+$/.test(billId) || billId.length < 2) return "unknown";
  return SERVICE_TYPE_CODES[billId[billId.length - 2]] ?? "unknown";
}

export class InvalidBillNumbersError extends Error {}

export function parseBillNumbers(raw: string): BillNumbers {
  const cleaned = normalizeFaDigits(raw)
    .split("")
    .filter((c) => /\d/.test(c) || /\s/.test(c))
    .join("");
  const parts = cleaned.trim().split(/\s+/).filter(Boolean);
  let billId: string;
  let payId: string | null = null;
  if (parts.length === 1 && parts[0].length === 26) {
    billId = parts[0].slice(0, 13);
    payId = parts[0].slice(13);
  } else if (parts.length >= 2) {
    billId = parts[0];
    payId = parts[1];
  } else if (parts.length === 1) {
    billId = parts[0];
  } else {
    throw new InvalidBillNumbersError("no digits found");
  }
  if (!isValidBillId(billId)) {
    throw new InvalidBillNumbersError(`invalid bill id checksum: ${billId}`);
  }
  return { billId, payId, utilityType: utilityTypeFor(billId) };
}
