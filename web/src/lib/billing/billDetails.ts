// Port of legacy src/energybot/billing/bill_details.py — normalizes Finnotech
// `detailBillingInquiry` payloads into structured bill details.

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return null;
  const f = Number(s);
  if (!Number.isFinite(f)) return null;
  return Number.isInteger(f) ? f : f;
}

function compact<T extends Record<string, unknown>>(d: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export interface ElectricityDetails {
  company?: string;
  customer?: string | null;
  customerType?: string;
  tariff?: string;
  phase?: number;
  amper?: number;
  period?: { year?: number; number?: number; days?: number };
  reading?: { previousDate?: string; currentDate?: string };
  dueDate?: string;
  consumption?: {
    normal?: number;
    peak?: number;
    low?: number;
    friday?: number;
    reactive?: number;
    average?: number;
    total?: number;
    unit?: string;
  };
  amounts?: {
    period?: number;
    previousDebt?: number;
    payable?: number;
    payAmount?: number;
    energy?: number;
    tax?: number;
    subscription?: number;
  };
}

function parseElectricity(result: Record<string, unknown>, info: Record<string, unknown>): ElectricityDetails {
  const normal = num(info.NormalConsumption);
  const peak = num(info.PeakConsumption);
  const low = num(info.LowConsumption);
  const friday = num(info.FridayConsumption);
  const tiered = [normal, peak, low, friday].filter((x): x is number => x !== null);
  const total = tiered.length ? tiered.reduce((a, b) => a + b, 0) : null;

  const consumption = compact({
    normal,
    peak,
    low,
    friday,
    reactive: num(info.ReactiveConsumption),
    average: num(info.AverageConsumption),
    total,
    unit: total !== null ? "kWh" : null,
  });
  const period = compact({
    year: num(info.Year),
    number: num(info.Period),
    days: num(info.TotalDaysCount),
  });
  const reading = compact({
    previousDate: (info.PreviousReadingDate as string) ?? null,
    currentDate: (info.CurrentReadingDate as string) ?? null,
  });
  const amounts = compact({
    period: num(info.PeriodAmount),
    previousDebt: num(info.PreviousDebt),
    payable: num(info.BillPayableAmount),
    payAmount: num(result.Amount),
    energy: num(info.EnergyAmount),
    tax: num(info.TaxAmount),
    subscription: num(info.SubscriptionAmount),
  });
  return compact({
    company: (info.CompanyName as string) ?? null,
    customer: ((info.CustomerName as string) ?? "").trim() || null,
    customerType: (info.CustomerType as string) ?? null,
    tariff: (info.TariffType as string) ?? null,
    phase: num(info.Phase),
    amper: num(info.Amper),
    period: period as ElectricityDetails["period"],
    reading: reading as ElectricityDetails["reading"],
    dueDate: (result.Date as string) ?? null,
    consumption: consumption as ElectricityDetails["consumption"],
    amounts: amounts as ElectricityDetails["amounts"],
  }) as ElectricityDetails;
}

export function parseBillDetails(utilityType: string, raw: unknown): Record<string, unknown> {
  const result = ((raw as Record<string, unknown>)?.result ?? {}) as Record<string, unknown>;
  const info = (result.Info ?? {}) as Record<string, unknown>;
  if (utilityType === "electricity") {
    return parseElectricity(result, info) as unknown as Record<string, unknown>;
  }
  // gas/water/unknown: passthrough until dedicated parsers exist.
  return Object.keys(info).length ? { rawInfo: info } : {};
}
