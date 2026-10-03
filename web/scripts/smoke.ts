// Dev smoke: exercises the user flow against a running server.
// Usage: BASE_URL=http://localhost:3100 BALE_BOT_TOKEN=... npx tsx scripts/smoke.ts

import { signInitData } from "@/lib/auth/initData";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TOKEN = process.env.BALE_BOT_TOKEN ?? "smoke-bale-token";

async function main(): Promise<void> {
  const initData = signInitData(TOKEN, {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAFx",
    user: JSON.stringify({ id: 987654321, first_name: "دخ", username: "smokeuser", language_code: "fa" }),
  });
  const r = await fetch(`${BASE}/api/auth/miniapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "bale", initData }),
  });
  console.log("miniapp exchange:", r.status);
  const cookie = r.headers.getSetCookie()[0].split(";")[0];

  const meRes = await fetch(`${BASE}/api/me`, { headers: { cookie } });
  const me = (await meRes.json()) as { csrf: string; user: unknown };
  console.log("me:", meRes.status, JSON.stringify(me.user));

  const cap = await fetch(`${BASE}/api/bills`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, "x-csrf": me.csrf },
    body: JSON.stringify({ text: "9706459904126" }),
  });
  console.log("bill capture:", cap.status, JSON.stringify((await cap.json())).slice(0, 200));

  const list = await fetch(`${BASE}/api/bills`, { headers: { cookie } });
  const lj = (await list.json()) as { bills?: { amountLabel: string }[] };
  console.log("bill list:", list.status, "count:", lj.bills?.length, "amount:", lj.bills?.[0]?.amountLabel);

  const noCsrf = await fetch(`${BASE}/api/bills`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: "{}",
  });
  console.log("no-csrf mutation blocked:", noCsrf.status);

  const bad = await fetch(`${BASE}/api/auth/miniapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "bale", initData: initData.replace(/hash=.{8}/, "hash=deadbeef") }),
  });
  console.log("tampered initData rejected:", bad.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
