// Port of legacy src/energybot/billing/finnotech_client.py — inquiry only.
// Payments were dropped in the rewrite.

import { randomUUID } from "node:crypto";
import { utilityTypeFor } from "./billNumbers";
import { parseBillDetails } from "./billDetails";
import { env } from "@/lib/env";

export interface BillDetail {
  billId: string;
  payId: string | null;
  amount: number; // rial
  utilityType: string;
  term: string | null;
  dueDate: string | null;
  raw: Record<string, unknown>;
  details: Record<string, unknown>;
}

export class FinnotechError extends Error {}

const FINNOTECH_TYPE: Record<string, string> = {
  water: "Water",
  electricity: "Electricity",
  gas: "Gas",
  tel: "Tel",
  mobile: "Mobile",
  municipality: "Municipality",
};

/** Injectable transport so tests can stub responses. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class FinnotechClient {
  private token: string | null = null;
  private tokenExpiresAt = 0; // Date.now() based

  constructor(private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const c = env.finnotech();
    if (!c.clientId || !c.clientSecret) throw new FinnotechError("finnotech not configured");
    const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
    let r: Response;
    try {
      r = await this.fetchImpl(`${c.baseUrl}${c.tokenPath}`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          nid: c.nationalId,
          scopes: "utility:bill:inquiry:get",
        }),
      });
    } catch (e) {
      throw new FinnotechError(`token request failed: ${String(e)}`);
    }
    if (!r.ok) throw new FinnotechError(`token http ${r.status}`);
    const data = (await r.json()) as { result?: { value?: string; lifeTime?: number } };
    const token = data.result?.value;
    if (!token) throw new FinnotechError("no token in response");
    this.token = token;
    this.tokenExpiresAt = Date.now() + (data.result?.lifeTime ?? 3_600_000);
    return token;
  }

  async inquireBill(billId: string): Promise<BillDetail> {
    const token = await this.ensureToken();
    const c = env.finnotech();
    const utype = utilityTypeFor(billId);
    const finType = FINNOTECH_TYPE[utype] ?? "Electricity";
    // detailBillingInquiry takes the bill identifier as `parameter` plus the
    // service `type`; the older billId-only form is rejected as a bad URL.
    const url =
      `${c.baseUrl}${c.inquiryPath.replace("{client_id}", c.clientId)}` +
      `?type=${finType}&parameter=${encodeURIComponent(billId)}&trackId=${randomUUID().replaceAll("-", "")}`;
    let r: Response;
    try {
      r = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      throw new FinnotechError(`inquiry request failed: ${String(e)}`);
    }
    if (!r.ok) throw new FinnotechError(`inquiry http ${r.status}`);
    const data = (await r.json()) as Record<string, any>;
    const status = String(data.status ?? "").toUpperCase();
    if (!["DONE", "OK", "SUCCESS"].includes(status)) {
      throw new FinnotechError(`inquiry failed: status=${data.status} code=${data.error?.code}`);
    }
    const result = data.result ?? {};
    // A DONE response with no Amount means "قبضی یافت نشد" (no bill matched).
    const amountRaw = result.Amount ?? result.amount ?? result.billAmount;
    if (amountRaw === null || amountRaw === undefined) {
      throw new FinnotechError(result.message ? String(result.message) : "no bill found");
    }
    const info = result.Info ?? {};
    const year = info.Year;
    const period = info.Period;
    const term = year && period ? `${year}/${period}` : (result.term ?? result.period ?? null);
    const payId = result.PayId ?? result.payId ?? result.paymentId ?? null;
    return {
      billId: String(result.BillId ?? result.billId ?? billId),
      payId: payId != null ? String(payId) : null,
      amount: Number(String(amountRaw).replace(/,/g, "") || 0),
      utilityType: utype,
      term: term != null ? String(term) : null,
      dueDate: (result.Date ?? result.dueDate ?? result.paymentDeadLine ?? null) as string | null,
      raw: data,
      details: parseBillDetails(utype, data),
    };
  }
}

/** Deterministic offline stub for tests and dev without Finnotech credentials. */
export class FakeFinnotechClient {
  constructor(private readonly detail?: BillDetail, private readonly error?: Error) {}

  async inquireBill(billId: string): Promise<BillDetail> {
    if (this.error) throw this.error;
    if (this.detail) return this.detail;
    return {
      billId,
      payId: "0151101290107",
      amount: 1_520_000,
      utilityType: "electricity",
      term: "1404/03",
      dueDate: "1404/04/15",
      raw: {},
      details: {},
    };
  }
}
