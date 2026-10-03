import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, test, expect } from "vitest";

const root = join(dirname(__filename), "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(tsx|ts)$/.test(e.name) ? [p] : [];
  });
}

function block(selector: string): string {
  const start = css.indexOf(selector + " {");
  expect(start, `globals.css must contain a "${selector} {…}" block`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const depthFrom = open;
  let depth = 0;
  for (let i = depthFrom; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(depthFrom, i);
    }
  }
  throw new Error(`Unterminated block for ${selector}`);
}

const REQUIRED_TOKENS = [
  "--background", "--foreground",
  "--card", "--card-foreground",
  "--popover", "--popover-foreground",
  "--primary", "--primary-foreground",
  "--secondary", "--secondary-foreground",
  "--muted", "--muted-foreground",
  "--accent", "--accent-foreground",
  "--destructive", "--warning",
  "--border", "--input", "--ring",
  "--streak", "--streak-foreground",
];
// Theme-invariant tokens: defined once in :root, inherited by .dark.
const ROOT_ONLY_TOKENS = ["--radius"];

describe("design tokens (Stitch pass)", () => {
  test("complete token set in both :root and .dark, no placeholders left", () => {
    expect(css).not.toContain("PLACEHOLDER");
    const light = block(":root");
    const dark = block(".dark");
    for (const token of [...REQUIRED_TOKENS, ...ROOT_ONLY_TOKENS]) {
      expect(light, `:root must define ${token}`).toContain(token + ":");
    }
    for (const token of REQUIRED_TOKENS) {
      expect(dark, `.dark must define ${token}`).toContain(token + ":");
    }
  });

  test("primary is the emerald anchor (#059669) in light mode", () => {
    expect(block(":root")).toMatch(/--primary:\s*oklch\(0\.596 0\.13 163\)/);
  });

  test("streak amber exists and is mapped into the Tailwind theme", () => {
    expect(block(":root")).toMatch(/--streak:\s*oklch\(/);
    expect(block(".dark")).toMatch(/--streak:\s*oklch\(/);
    expect(css).toMatch(/--color-streak:\s*var\(--streak\)/);
    expect(css).toMatch(/--color-streak-foreground:\s*var\(--streak-foreground\)/);
  });

  test("ROUND_FULL: base radius is at least 20px", () => {
    const m = block(":root").match(/--radius:\s*([\d.]+)rem/);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBeGreaterThanOrEqual(1.25);
  });

  test("prefers-reduced-motion is honored globally", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  test("no cascade collisions — tokens are declared exactly once per mode, never shadowed", () => {
    // A later same-specificity block (the old legacy-alias block) silently
    // overrode --muted/--accent, so the finalized tokens never reached the DOM.
    const declared = (name: string) => (css.match(new RegExp(`--${name}:`, "g")) ?? []).length;
    for (const token of ["muted", "accent", "primary", "secondary", "background", "card", "streak"]) {
      expect(declared(token), `--${token} must be declared exactly twice (:root + .dark)`).toBe(2);
    }
    // The alias-only names must not exist at all anymore.
    for (const legacy of ["bg:", "surface:", "fg:", "accent-fg:"]) {
      expect(css).not.toContain(`--${legacy}`);
    }
  });
});

describe("legacy alias sweep (retrofit)", () => {
  test("no component references legacy alias vars", () => {
    // Old usages meant: --muted = muted TEXT (now --muted-foreground),
    // --accent/--accent-fg = brand (now --primary/--primary-foreground),
    // --surface/--bg/--fg = shells (now --card/--background/--foreground).
    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      if (file.includes("globals.css")) continue;
      const text = readFileSync(file, "utf8");
      if (/var\(--(muted|accent-fg|surface|bg|fg)\)/.test(text)) offenders.push(file);
    }
    expect(offenders, `files still using legacy alias vars: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("font (Vazirmatn bundled locally)", () => {
  test("no Google-font dependency; next/font/local is used", () => {
    expect(layout).not.toContain("next/font/google");
    expect(layout).toContain("next/font/local");
  });

  test("the referenced woff2 file exists in src/fonts", () => {
    const m = layout.match(/src:\s*"([^"]+\.woff2)"/);
    expect(m, "layout must declare a local .woff2 src").not.toBeNull();
    const fontPath = join(root, "src/app", m![1]);
    expect(existsSync(fontPath), `${fontPath} should exist`).toBe(true);
  });

  test("Vazirmatn is the html font-family", () => {
    expect(css).toMatch(/font-family:\s*Vazirmatn/);
  });
});
