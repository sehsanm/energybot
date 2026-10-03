// Upload intake guards shared by the web route (and mirrored by the bot
// handler): size caps and magic-byte type checks — never trust names/MIME.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TEXT_LEN = 200;

export type UploadKind = "pdf" | "image";

/** Magic-byte sniffing; extensions and client MIME headers are advisory only. */
export function sniffUploadKind(bytes: Buffer): UploadKind | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // JPEG
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";
  // PNG
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image";
  // WebP (RIFF....WEBP)
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image";
  }
  // GIF
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("latin1"))) return "image";
  return null;
}

export type GuardResult = { ok: true; kind: UploadKind } | { ok: false; error: string };

export function guardUploadBytes(bytes: Buffer, declaredName = ""): GuardResult {
  if (bytes.length === 0) return { ok: false, error: "فایل خالی است." };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "حجم فایل باید کمتر از ۱۰ مگابایت باشد." };
  const kind = sniffUploadKind(bytes);
  if (!kind) {
    return {
      ok: false,
      error: `فقط عکس (JPEG/PNG/WebP) یا PDF قبول می‌شود${declaredName ? ` — «${declaredName}»` : ""}.`,
    };
  }
  return { ok: true, kind };
}
