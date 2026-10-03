// Persian number/currency formatting shared by bot copy and web UI.

const FA = "۰۱۲۳۴۵۶۷۸۹";

export function toPersianDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => FA[Number(d)]);
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
