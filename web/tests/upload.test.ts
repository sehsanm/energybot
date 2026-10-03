import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guardUploadBytes, sniffUploadKind, MAX_TEXT_LEN, MAX_UPLOAD_BYTES } from "@/lib/billing/upload";

const FIXTURES = path.resolve(__dirname, "fixtures");

function withPrefix(prefix: string, len: number): Buffer {
  return Buffer.concat([Buffer.from(prefix, "latin1"), Buffer.alloc(Math.max(0, len - prefix.length))]);
}

describe("sniffUploadKind", () => {
  it("recognizes PDF/JPEG/PNG/WebP by magic bytes, not names", () => {
    expect(sniffUploadKind(withPrefix("%PDF-1.7", 32))).toBe("pdf");
    expect(sniffUploadKind(withPrefix("\xff\xd8\xff\xe0", 32))).toBe("image");
    expect(sniffUploadKind(withPrefix("\x89PNG\r\n\x1a\n", 32))).toBe("image");
    expect(sniffUploadKind(withPrefix("RIFF0000WEBPVP8 ", 16))).toBe("image");
    expect(sniffUploadKind(withPrefix("GIF89a", 32))).toBe("image");
  });
  it("rejects everything else", () => {
    expect(sniffUploadKind(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(sniffUploadKind(Buffer.from("exe".padEnd(64, "\0")))).toBeNull();
  });
  it("classifies the real bill fixture as an image", () => {
    expect(sniffUploadKind(readFileSync(path.join(FIXTURES, "bill_barcode_sample.png")))).toBe("image");
  });
});

describe("guardUploadBytes", () => {
  it("rejects empty and oversized payloads with Persian errors", () => {
    expect(guardUploadBytes(Buffer.alloc(0)).ok).toBe(false);
    const tooBig = guardUploadBytes(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x89));
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toContain("۱۰ مگابایت");
  });
  it("rejects disallowed content types", () => {
    const res = guardUploadBytes(Buffer.from("<html>not a bill</html>"), "bill.html");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("bill.html");
  });
  it("accepts a valid PDF payload", () => {
    expect(guardUploadBytes(withPrefix("%PDF-1.4", 128)).ok).toBe(true);
  });
  it("exports sane text cap", () => {
    expect(MAX_TEXT_LEN).toBeLessThan(1000);
  });
});
