// Parser for the seed KB markdown files (title/category/tags + course metadata).

export interface KbFrontmatter {
  title: string;
  category: string;
  tags: string[];
  utility?: "electricity" | "gas" | "both";
  difficulty?: "starter" | "medium" | "deep";
  minutes?: number;
  sources: string[];
  objectives: string[];
  keyFacts: string[];
  body: string;
}

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

const UTILITY = ["electricity", "gas", "both"] as const;
const DIFFICULTY = ["starter", "medium", "deep"] as const;

const enumOr = <T extends readonly string[]>(list: T, v: string | undefined): T[number] | undefined =>
  (list as readonly string[]).includes(v ?? "") ? (v as T[number]) : undefined;

function parseList(raw: string | undefined): string[] {
  const value = raw ?? "";
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
    return []; // valid JSON but not an array → empty (original tags behavior)
  } catch {
    return value
      .replace(/[[\]"]/g, "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
}

export function parseFrontmatter(raw: string, fallbackTitle = ""): KbFrontmatter {
  const m = FM_RE.exec(raw);
  if (!m) {
    // No frontmatter: first "# heading" (if any) becomes the title.
    const body = raw.trim();
    const h = /^#\s+(.+)$/m.exec(body);
    return {
      title: h?.[1]?.trim() || fallbackTitle,
      category: "general",
      tags: [],
      sources: [],
      objectives: [],
      keyFacts: [],
      body: h ? body.replace(h[0], "").trim() : body,
    };
  }
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) meta[k] = v;
  }
  const minutesRaw = Number(meta.minutes);
  const minutes = Number.isInteger(minutesRaw) && minutesRaw > 0 ? minutesRaw : undefined;
  return {
    title: meta.title || fallbackTitle,
    category: (meta.category || "general").toLowerCase(),
    tags: parseList(meta.tags),
    utility: enumOr(UTILITY, meta.utility),
    difficulty: enumOr(DIFFICULTY, meta.difficulty),
    minutes,
    sources: parseList(meta.sources),
    objectives: parseList(meta.objectives),
    keyFacts: parseList(meta.keyFacts),
    body: m[2].trim(),
  };
}
