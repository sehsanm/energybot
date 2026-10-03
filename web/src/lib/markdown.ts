// Minimal markdown parser for the KB subset (headings, bullets, ordered
// lists, bold, hr) — pure, no dependency. The renderer component maps blocks
// to React elements.

export interface InlineSegment {
  text: string;
  bold: boolean;
}

export type MdBlock =
  | { kind: "h1"; inline: InlineSegment[] }
  | { kind: "h2"; inline: InlineSegment[] }
  | { kind: "h3"; inline: InlineSegment[] }
  | { kind: "p"; inline: InlineSegment[] }
  | { kind: "ul"; items: InlineSegment[][] }
  | { kind: "ol"; items: InlineSegment[][] }
  | { kind: "hr" };

/** Split a line into bold (**…**) and plain segments. */
export function parseInline(line: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  let i = 0;
  while (i < line.length) {
    const start = line.indexOf("**", i);
    if (start === -1) {
      if (i < line.length) out.push({ text: line.slice(i), bold: false });
      break;
    }
    const end = line.indexOf("**", start + 2);
    if (end === -1) {
      out.push({ text: line.slice(i), bold: false });
      break;
    }
    if (start > i) out.push({ text: line.slice(i, start), bold: false });
    out.push({ text: line.slice(start + 2, end), bold: true });
    i = end + 2;
  }
  return out.length ? out : [{ text: "", bold: false }];
}

export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = md.split(/\r?\n/);

  let list: { kind: "ul" | "ol"; items: InlineSegment[][] } | null = null;
  const closeList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const kind = (["h1", "h2", "h3"] as const)[heading[1].length - 1];
      blocks.push({ kind, inline: parseInline(heading[2]) });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      blocks.push({ kind: "hr" });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      if (!list || list.kind !== "ul") {
        closeList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(parseInline(bullet[1]));
      continue;
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    if (ordered) {
      if (!list || list.kind !== "ol") {
        closeList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(parseInline(ordered[1]));
      continue;
    }
    closeList();
    blocks.push({ kind: "p", inline: parseInline(line.trim()) });
  }
  closeList();
  return blocks;
}
