// Legacy→new bill-details key mapping. The Python app stored snake_case keys
// (bill_details.py: previous_debt, pay_amount, due_date, customer_type,
// reading.previous_date/current_date, raw_info); every reader in this app
// expects camelCase. Used by scripts/migrate-from-legacy.ts.

const AMOUNTS: Record<string, string> = {
  period: "period",
  previous_debt: "previousDebt",
  payable: "payable",
  pay_amount: "payAmount",
  energy: "energy",
  tax: "tax",
  subscription: "subscription",
};

const READING: Record<string, string> = {
  previous_date: "previousDate",
  current_date: "currentDate",
};

const TOP: Record<string, string> = {
  company: "company",
  customer: "customer",
  customer_type: "customerType",
  tariff: "tariff",
  phase: "phase",
  amper: "amper",
  period: "period",
  reading: "reading",
  due_date: "dueDate",
  consumption: "consumption",
  amounts: "amounts",
  raw_info: "rawInfo",
};

function remap(node: unknown, map: Record<string, string>): Record<string, unknown> {
  if (!node || typeof node !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[map[k] ?? k] = v;
  }
  return out;
}

/** Map a legacy details JSON tree onto the camelCase shape this app reads. */
export function camelizeLegacyDetails(details: unknown): Record<string, unknown> {
  const out = remap(details, TOP);
  const src = (details ?? {}) as Record<string, unknown>;
  if (src.amounts) out.amounts = remap(src.amounts, AMOUNTS);
  if (src.reading) out.reading = remap(src.reading, READING);
  return out;
}

/**
 * Legacy stored `amounts.period ?? finnotech_amount` (repository.add_bill).
 * New capture does the same; normalize migrated rows so the raw column means
 * the same thing for old and new bills.
 */
export function legacyStoredAmount(details: unknown, finnotechAmount: number): number {
  const period = (camelizeLegacyDetails(details).amounts as Record<string, unknown> | undefined)?.period;
  const n = Number(period);
  return period != null && Number.isFinite(n) ? n : finnotechAmount;
}
