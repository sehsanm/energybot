export const UTIL = (t: string) =>
  t === "electricity" ? "برق" : t === "gas" ? "گاز" : t === "water" ? "آب" : "قبض";

// amounts are stored in rial; users think in toman (rial / 10)
export const toman = (rial: number) => `${Math.floor(rial / 10).toLocaleString("fa-IR")} تومان`;

export const faNum = (n: number | string) => Number(n).toLocaleString("fa-IR");

// Format an ISO date ("YYYY-MM-DD") or datetime into a Jalali date string.
// Date-only values are built from their parts to avoid a timezone day-shift.
export function faDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
}

export type BadgeVariant =
  | "default" | "secondary" | "destructive" | "success" | "warning" | "accent" | "outline" | "muted";

export function billStatus(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "paid":
      return { label: "پرداخت‌شده", variant: "success" };
    case "unpaid":
      return { label: "پرداخت‌نشده", variant: "warning" };
    case "pending":
      return { label: "در انتظار", variant: "secondary" };
    case "expired":
      return { label: "منقضی", variant: "destructive" };
    default:
      return { label: status || "—", variant: "muted" };
  }
}
