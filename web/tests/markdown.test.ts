import { describe, it, expect } from "vitest";
import { parseMarkdown, type MdBlock } from "@/lib/markdown";

type Ul = Extract<MdBlock, { kind: "ul" }>;
type Ol = Extract<MdBlock, { kind: "ol" }>;
type P = Extract<MdBlock, { kind: "p" }>;

describe("parseMarkdown (KB subset)", () => {
  it("parses headings, paragraphs, bullets, and hr into blocks", () => {
    const blocks = parseMarkdown(
      "# عنوان\n\nمتن ساده.\n\n## زیرعنوان\n\n- مورد یک\n- مورد دو\n\n---\n\nپایان",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["h1", "p", "h2", "ul", "hr", "p"]);
    const ul = blocks[3] as Ul;
    expect(ul.items).toHaveLength(2);
    expect(ul.items[0]).toEqual([{ text: "مورد یک", bold: false }]);
  });

  it("splits inline bold into segments", () => {
    const blocks = parseMarkdown("متن **مهم** و ادامه");
    expect(blocks[0].kind).toBe("p");
    expect((blocks[0] as P).inline).toEqual([
      { text: "متن ", bold: false },
      { text: "مهم", bold: true },
      { text: " و ادامه", bold: false },
    ]);
  });

  it("keeps bold inside list items", () => {
    const blocks = parseMarkdown("- **کم‌مصرف:** مصرف پایین");
    expect((blocks[0] as Ul).items[0]).toEqual([
      { text: "کم‌مصرف:", bold: true },
      { text: " مصرف پایین", bold: false },
    ]);
  });

  it("parses ordered lists separately from bullets", () => {
    const blocks = parseMarkdown("1. اول\n2. دوم");
    expect(blocks[0].kind).toBe("ol");
    expect((blocks[0] as Ol).items).toHaveLength(2);
  });

  it("collapses blank lines and ignores frontmatter-style dividers at top", () => {
    const blocks = parseMarkdown("\n\n# فقط عنوان\n\n\n\nپاراگراف\n\n");
    expect(blocks.map((b) => b.kind)).toEqual(["h1", "p"]);
  });
});
