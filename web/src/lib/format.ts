// Persian number/currency formatting shared by bot copy and web UI.

const FA = "۰۱۲۳۴۵۶۷۸۹";

/** Persian digits, and the Arabic thousands separator ٬ (U+066C) for commas —
 *  parity with the legacy renderer (billing/service.py _to_persian_digits). */
export function toPersianDigits(s: string | number): string {
  return String(s)
    .replace(/[0-9]/g, (d) => FA[Number(d)])
    .replace(/,/g, "٬");
}

export function fmtAmountRial(rial: number): string {
  const toman = Math.floor(rial / 10);
  return toPersianDigits(toman.toLocaleString("en-US")) + " تومان";
}

export function fmtKwh(v: number): string {
  const s = Number.isInteger(v)
    ? v.toLocaleString("en-US")
    : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return toPersianDigits(s).replace(".", "٫");
}
