// Port of legacy core/normalize_fa.py — Persian text normalization used for
// both the FTS index and queries, so Arabic variants/ZWNJ quirks still match.

const ARABIC_TO_PERSIAN: Record<string, string> = {
  "ك": "ک", "ي": "ی", "ى": "ی", "ة": "ه", "أ": "ا", "إ": "ا", "آ": "آ", "ؤ": "و", "ئ": "ی",
};
const ARABIC_DIGITS: Record<string, string> = {
  "٠": "۰", "١": "۱", "٢": "۲", "٣": "۳", "٤": "۴",
  "٥": "۵", "٦": "۶", "٧": "۷", "٨": "۸", "٩": "۹",
};

export const ZWNJ = "\u200c";

export function normalizeFa(input: string): string {
  if (!input) return "";
  let s = input.replace(/[كيىةأإآؤئ]/g, (c) => ARABIC_TO_PERSIAN[c] ?? c);
  s = s.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] ?? d);
  s = s.replace(new RegExp(`${ZWNJ}{2,}`, "g"), ZWNJ); // collapse runs
  const boundary = new RegExp(`(\\s+${ZWNJ})|(${ZWNJ}\\s+)`, "g");
  // Two passes: "م [ZWNJ] ر" → pass1 "مZWNJ ر" → pass2 "مZWNJر" (single pass
  // consumes the ZWNJ and misses the trailing space, like the legacy regex).
  s = s.replace(boundary, ZWNJ).replace(boundary, ZWNJ);
  s = s.replace(/\s+/g, " ").trim();
  return s.toLowerCase();
}

// Persian function words that match almost every document — dropped from queries.
const STOPWORDS = new Set([
  "را", "و", "به", "از", "که", "این", "با", "برای", "تا", "است", "های", "هم", "در", "یا",
  "چه", "ها", "می", "شد", "شده", "بود", "باشد", "کن", "کند", "کنید", "من", "تو", "شما",
]);

/** Safe FTS5 MATCH expression: quoted prefix-terms joined with OR. */
export function toFtsQuery(normalizedQuery: string, maxTerms = 8): string {
  const words = normalizedQuery
    .split(/\s+/)
    .map((w) => w.replace(/["*()]/g, ""))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && /[a-z0-9\u0621-\u064a\u06f0-\u06f9]/.test(w))
    .slice(0, maxTerms);
  if (!words.length) return "";
  return words.map((w) => `"${w}"*`).join(" OR ");
}
