// Char-based port of the legacy tiktoken chunker (kb/chunking.py): same
// paragraph → sentence fallback structure and overlap mechanics, without the
// tokenizer dependency (~1200 chars ≈ the legacy 400 tokens for Persian).

const PARA = /\n\s*\n/;
const SENT = /(?<=[.؟!:]|\u061F)\s+/;

export function chunkText(
  text: string,
  opts: { targetChars?: number; overlapChars?: number } = {},
): string[] {
  const target = opts.targetChars ?? 1200;
  const overlapTarget = opts.overlapChars ?? 200;
  const t = text.trim();
  if (!t) return [];
  if (t.length <= target) return [t];

  const units: string[] = [];
  for (const p of t.split(PARA)) {
    const para = p.trim();
    if (!para) continue;
    if (para.length <= target) {
      units.push(para);
    } else {
      const sents = para.split(SENT).map((s) => s.trim()).filter(Boolean);
      units.push(...(sents.length ? sents : [para]));
    }
  }

  const chunks: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const u of units) {
    if (curLen + u.length > target && cur.length) {
      chunks.push(cur.join(" "));
      const overlap: string[] = [];
      let tally = 0;
      for (const prev of [...cur].reverse()) {
        if (tally + prev.length > overlapTarget) break;
        overlap.unshift(prev);
        tally += prev.length;
      }
      cur = [...overlap];
      curLen = tally;
    }
    cur.push(u);
    curLen += u.length;
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}
