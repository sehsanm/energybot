// Parser for the seed KB markdown files (title/category/tags frontmatter).

export interface KbFrontmatter {
  title: string;
  category: string;
  tags: string[];
  body: string;
}

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

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
  let tags: string[] = [];
  const rawTags = meta.tags ?? "";
  try {
    const parsed = JSON.parse(rawTags);
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = rawTags
      .replace(/[[\]"]/g, "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return {
    title: meta.title || fallbackTitle,
    category: (meta.category || "general").toLowerCase(),
    tags,
    body: m[2].trim(),
  };
}
