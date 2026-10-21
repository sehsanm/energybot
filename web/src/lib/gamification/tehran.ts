// Tehran calendar-day helpers for the streak engine. Pure date math — the
// caller injects the timestamp; nothing here reads the clock itself.

const DAY_MS = 24 * 60 * 60 * 1000;

// en-CA yields ISO-like YYYY-MM-DD; Asia/Tehran is a fixed UTC+3:30 offset
// (no DST since 2022), so the day boundary is 20:30 UTC.
const tehranDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" });

/** The Asia/Tehran calendar day (YYYY-MM-DD) containing instant `ts`. */
export function tehranDate(ts: number): string {
  return tehranDayFormatter.format(new Date(ts));
}

/** Calendar-day difference b − a for two YYYY-MM-DD strings (UTC-parsed, so no DST drift). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}
