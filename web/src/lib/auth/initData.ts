// Mini-app `initData` validation (Telegram WebAppData scheme; Bale copies it
// exactly — only the signing bot token differs). Port of the 2026-10-01 spec §5.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface InitDataUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: InitDataUser;
  authDate: number;
}

export type InitDataError =
  | "missing_hash"
  | "bad_signature"
  | "stale"
  | "no_user";

export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86_400,
): { ok: true; data: ValidatedInitData } | { ok: false; error: InitDataError } {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "missing_hash" };

  // data_check_string: all fields except hash, sorted by key, joined with \n.
  const pairs = [...params.entries()].filter(([k]) => k !== "hash").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = createHmac("sha256", botToken).update("WebAppData").digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "bad_signature" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) {
    return { ok: false, error: "stale" };
  }

  let user: InitDataUser | null = null;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    user = null;
  }
  if (!user || (user.id === undefined && user.id !== 0)) return { ok: false, error: "no_user" };
  return { ok: true, data: { user, authDate } };
}

/** Build a signed initData string — used by tests to construct valid payloads. */
export function signInitData(botToken: string, fields: Record<string, string>): string {
  const pairs = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", botToken).update("WebAppData").digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams([...pairs, ["hash", hash]] as string[][]).toString();
}
