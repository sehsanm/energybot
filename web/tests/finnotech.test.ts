import { afterEach, describe, expect, it, vi } from "vitest";
import { FinnotechClient, FinnotechError, type FetchLike } from "@/lib/billing/finnotech";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TOKEN_BODY = { result: { value: "tok-1", lifeTime: 3_600_000 } };
const DONE_BODY = {
  status: "DONE",
  result: {
    BillId: "9706459904126",
    PayId: "0001727250230",
    Amount: "1,520,000",
    Date: "1404/04/15",
    Info: { Year: "1404", Period: "03", NormalConsumption: "600" },
  },
};

function stubEnv() {
  vi.stubEnv("FINNOTECH_CLIENT_ID", "cid");
  vi.stubEnv("FINNOTECH_CLIENT_SECRET", "sec");
  vi.stubEnv("FINNOTECH_NATIONAL_ID", "0012345678");
  vi.stubEnv("FINNOTECH_BASE_URL", "https://fin.test");
  vi.stubEnv("FINNOTECH_TOKEN_PATH", "/token");
  vi.stubEnv("FINNOTECH_INQUIRY_PATH", "/oak/v2/clients/{client_id}/utility/detailBillingInquiry");
}
afterEach(() => vi.unstubAllEnvs());

describe("FinnotechClient", () => {
  it("fetches a token once, caches it, and parses the inquiry", async () => {
    stubEnv();
    const calls: { url: string; auth?: string }[] = [];
    const fetchStub: FetchLike = async (url, init) => {
      const auth = (init.headers as Record<string, string>)?.Authorization;
      calls.push({ url, auth });
      if (url.endsWith("/token")) return jsonResponse(200, TOKEN_BODY);
      return jsonResponse(200, DONE_BODY);
    };
    const c = new FinnotechClient(fetchStub);
    const d1 = await c.inquireBill("9706459904126");
    const d2 = await c.inquireBill("9706459904126");

    expect(calls.filter((x) => x.url.endsWith("/token"))).toHaveLength(1); // token cached
    expect(d1.amount).toBe(1_520_000);
    expect(d1.term).toBe("1404/03");
    expect(d1.payId).toBe("0001727250230");
    expect(d1.utilityType).toBe("electricity");
    expect(d1.details.consumption).toEqual({ normal: 600, total: 600, unit: "kWh" });
    expect(calls[1].url).toContain("type=Electricity");
    expect(calls[1].url).toContain("parameter=9706459904126");
    expect(calls[1].url).toContain("/oak/v2/clients/cid/utility/detailBillingInquiry");
    expect(calls[1].auth).toBe("Bearer tok-1");
    expect(d2.billId).toBe("9706459904126");
  });

  it("sends Basic auth + nid on the token request", async () => {
    stubEnv();
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchStub: FetchLike = async (url, init) => {
      if (url.endsWith("/token")) {
        seen = { url, init };
        return jsonResponse(200, TOKEN_BODY);
      }
      return jsonResponse(200, DONE_BODY);
    };
    await new FinnotechClient(fetchStub).inquireBill("9706459904126");
    const basic = Buffer.from("cid:sec").toString("base64");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${basic}`);
    expect(JSON.parse(String(seen!.init.body)).nid).toBe("0012345678");
  });

  it("raises FinnotechError on non-DONE status", async () => {
    stubEnv();
    const fetchStub: FetchLike = async (url) =>
      url.endsWith("/token") ? jsonResponse(200, TOKEN_BODY) : jsonResponse(200, { status: "FAILED", error: { code: 123 } });
    await expect(new FinnotechClient(fetchStub).inquireBill("9706459904126")).rejects.toThrow(FinnotechError);
  });

  it("treats DONE with no Amount as 'no bill found'", async () => {
    stubEnv();
    const fetchStub: FetchLike = async (url) =>
      url.endsWith("/token") ? jsonResponse(200, TOKEN_BODY) : jsonResponse(200, { status: "DONE", result: { message: "قبضی یافت نشد" } });
    await expect(new FinnotechClient(fetchStub).inquireBill("9706459904126")).rejects.toThrow(/قبضی یافت نشد/);
  });

  it("surfaces token HTTP failures", async () => {
    stubEnv();
    const fetchStub: FetchLike = async (url) =>
      url.endsWith("/token") ? jsonResponse(401, { error: "unauthorized" }) : jsonResponse(200, DONE_BODY);
    await expect(new FinnotechClient(fetchStub).inquireBill("9706459904126")).rejects.toThrow(/token http 401/);
  });

  it("refuses to run unconfigured", async () => {
    vi.stubEnv("FINNOTECH_CLIENT_ID", "");
    await expect(new FinnotechClient(async () => jsonResponse(200, {})).inquireBill("9706459904126")).rejects.toThrow(
      /not configured/,
    );
  });
});
