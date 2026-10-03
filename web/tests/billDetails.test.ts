import { describe, expect, it } from "vitest";
import { parseBillDetails } from "@/lib/billing/billDetails";

const SAMPLE = {
  status: "DONE",
  result: {
    Amount: "1,520,000",
    Date: "1404/04/15",
    Info: {
      CompanyName: "برق توزیع تهران",
      CustomerName: "  علی رضایی  ",
      CustomerType: "Domestic",
      TariffType: "معماری",
      Phase: "1",
      Amper: "25",
      Year: "1404",
      Period: "03",
      TotalDaysCount: "31",
      PreviousReadingDate: "1404/01/10",
      CurrentReadingDate: "1404/02/10",
      NormalConsumption: "480",
      PeakConsumption: "60",
      LowConsumption: "40",
      FridayConsumption: "20",
      ReactiveConsumption: "0",
      AverageConsumption: "19.35",
      PeriodAmount: "1,400,000",
      PreviousDebt: "120,000",
      BillPayableAmount: "1,520,000",
      EnergyAmount: "1,300,000",
      TaxAmount: "80,000",
      SubscriptionAmount: "20,000",
    },
  },
};

describe("parseBillDetails (electricity)", () => {
  const d = parseBillDetails("electricity", SAMPLE) as any;

  it("normalizes consumption buckets and total", () => {
    expect(d.consumption.normal).toBe(480);
    expect(d.consumption.peak).toBe(60);
    expect(d.consumption.low).toBe(40);
    expect(d.consumption.friday).toBe(20);
    expect(d.consumption.total).toBe(600);
    expect(d.consumption.unit).toBe("kWh");
  });

  it("normalizes amounts (comma-stripped numbers)", () => {
    expect(d.amounts.period).toBe(1_400_000);
    expect(d.amounts.previousDebt).toBe(120_000);
    expect(d.amounts.payable).toBe(1_520_000);
    expect(d.amounts.payAmount).toBe(1_520_000);
  });

  it("keeps period, reading, tariff and trimmed customer", () => {
    expect(d.period.year).toBe(1404);
    expect(d.period.number).toBe(3);
    expect(d.period.days).toBe(31);
    expect(d.reading.currentDate).toBe("1404/02/10");
    expect(d.customer).toBe("علی رضایی");
    expect(d.tariff).toBe("معماری");
    expect(d.phase).toBe(1);
    expect(d.amper).toBe(25);
    expect(d.dueDate).toBe("1404/04/15");
  });

  it("passes through non-electricity raw info", () => {
    const gas = parseBillDetails("gas", SAMPLE) as { rawInfo: Record<string, unknown> };
    expect(gas.rawInfo.CompanyName).toBe(SAMPLE.result.Info.CompanyName);
    expect(gas.rawInfo.PeriodAmount).toBe("1,400,000");
  });
});
