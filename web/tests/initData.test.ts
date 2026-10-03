import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "@/lib/auth/initData";

const TOKEN = "test-bot-token";
const USER = JSON.stringify({ id: 123456789, first_name: "علی", username: "ali" });

function signed(fields: Record<string, string> = {}, token = TOKEN, authDate = Math.floor(Date.now() / 1000)): string {
  return signInitData(token, {
    auth_date: String(authDate),
    query_id: "AAF1",
    user: USER,
    ...fields,
  });
}

describe("validateInitData", () => {
  it("accepts a correctly signed payload", () => {
    const r = validateInitData(signed(), TOKEN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.user.id).toBe(123456789);
  });

  it("rejects a tampered payload", () => {
    const init = signed();
    const params = new URLSearchParams(init);
    params.set("user", JSON.stringify({ id: 1, first_name: "مهاجم" }));
    const r = validateInitData(params.toString(), TOKEN);
    expect(r).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects a signature made with the wrong bot token", () => {
    const r = validateInitData(signed({}, "other-token"), TOKEN);
    expect(r).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects stale auth_date", () => {
    const stale = Math.floor(Date.now() / 1000) - 2 * 86_400;
    const r = validateInitData(signed({ auth_date: String(stale) }), TOKEN);
    expect(r).toEqual({ ok: false, error: "stale" });
  });

  it("rejects a missing hash or user", () => {
    expect(validateInitData("auth_date=1&user=%7B%7D", TOKEN)).toEqual({ ok: false, error: "missing_hash" });
    const noUser = signInitData(TOKEN, { auth_date: String(Math.floor(Date.now() / 1000)) });
    const r = validateInitData(noUser, TOKEN);
    expect(r.ok).toBe(false);
  });
});
