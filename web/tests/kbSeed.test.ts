import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestDb } from "@/lib/db";
import { ensureSeeded, listArticles, normalizeArticleRow, saveArticle, searchKb } from "@/lib/kb/repository";

let tmp = "";
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = ""; });

function dirWith(files: Record<string, string>): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kbseed-"));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(tmp, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf-8");
  }
  return tmp;
}
const ART = (n: number, body = "متن مقاله دربارهٔ مصرف برق") => `---\ntitle: مقاله ${n}\ncategory: bills\ntags: ["الف"]\n---\n# ${body}\n`;

describe("seed reconciliation", () => {
  it("inserts new files (returns insert count)", () => {
    const db = makeTestDb();
    const d = dirWith({ "bills/01-a.md": ART(1), "bills/02-b.md": ART(2) });
    expect(ensureSeeded(db, [d])).toBe(2);
    expect(listArticles(db).map((x) => x.article.slug).sort()).toEqual(["01-a", "02-b"]);
  });

  it("updates a changed seed file: body re-chunks and old terms vanish from FTS", () => {
    const db = makeTestDb();
    const d = dirWith({ "bills/01-a.md": ART(1, "پکیج و شوفاژ") });
    ensureSeeded(db, [d]);
    expect(searchKb(db, "شوفاژ")).toHaveLength(1);
    fs.writeFileSync(path.join(d, "bills/01-a.md"), ART(1, "کولر گازی اینورتر"), "utf-8");
    expect(ensureSeeded(db, [d])).toBe(0); // update, not insert
    expect(searchKb(db, "شوفاژ")).toEqual([]);
    expect(searchKb(db, "اینورتر")).toHaveLength(1);
  });

  it("skips admin-edited rows even when the file changed", () => {
    const db = makeTestDb();
    const d = dirWith({ "bills/01-a.md": ART(1, "متن اول") });
    ensureSeeded(db, [d]);
    saveArticle(db, { slug: "01-a", title: "مقاله ۱", bodyMd: "ویرایش دستی ادمین", category: "bills", source: "admin" });
    fs.writeFileSync(path.join(d, "bills/01-a.md"), ART(1, "متن دوم از فایل"), "utf-8");
    ensureSeeded(db, [d]);
    const row = listArticles(db).find((x) => x.article.slug === "01-a")!.article;
    expect(row.bodyMd).toBe("ویرایش دستی ادمین");
  });

  it("deletes orphaned seed rows (renumbered move) but keeps orphaned admin rows", () => {
    const db = makeTestDb();
    const d1 = dirWith({ "gas/01-old.md": ART(1, "متن کهنه") });
    ensureSeeded(db, [d1]);
    saveArticle(db, { slug: "admin-made", title: "ادمین ساخت", bodyMd: "دستی", category: "bills", source: "admin" });
    fs.rmSync(tmp, { recursive: true, force: true });
    const d2 = dirWith({ "bills/04-new.md": ART(4, "متن تازه") }); // fresh tmp dir, old slug gone
    ensureSeeded(db, [d2]);
    const slugs = listArticles(db).map((x) => x.article.slug).sort();
    expect(slugs).toEqual(["04-new", "admin-made"]); // 01-old gone, admin row kept
  });

  it("second run over unchanged files is a no-op returning 0", () => {
    const db = makeTestDb();
    const d = dirWith({ "bills/01-a.md": ART(1) });
    ensureSeeded(db, [d]);
    expect(ensureSeeded(db, [d])).toBe(0);
    expect(listArticles(db)).toHaveLength(1);
  });

  it("scalar metadata removed from the file is cleared and the row converges", () => {
    const db = makeTestDb();
    const withMeta = `---\ntitle: مقاله 9\ncategory: bills\ntags: ["الف"]\nutility: gas\ndifficulty: deep\nminutes: 9\n---\n# متن مقاله دربارهٔ مصرف برق\n`;
    const d = dirWith({ "bills/09-u.md": withMeta });
    ensureSeeded(db, [d]);
    const seeded = listArticles(db).find((x) => x.article.slug === "09-u")!.article;
    expect(seeded.utility).toBe("gas"); expect(seeded.difficulty).toBe("deep"); expect(seeded.minutes).toBe(9);

    fs.writeFileSync(path.join(d, "bills/09-u.md"), ART(9), "utf-8"); // metadata lines dropped
    ensureSeeded(db, [d]);
    const row = listArticles(db).find((x) => x.article.slug === "09-u")!.article;
    expect(row.utility).toBe(null); expect(row.difficulty).toBe(null); expect(row.minutes).toBe(null);
    const view = normalizeArticleRow(row); // cleared fields read back with legacy defaults
    expect(view.utility).toBe("both"); expect(view.difficulty).toBe("starter"); expect(view.minutes).toBe(4);

    expect(ensureSeeded(db, [d])).toBe(0);
    const again = listArticles(db).find((x) => x.article.slug === "09-u")!.article;
    expect(again.updatedAt).toBe(row.updatedAt); // converged — the third run writes nothing
  });
});
