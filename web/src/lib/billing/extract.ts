// Port of legacy billing/barcode.py + billing/pdf.py.
// Photos: sharp → grayscale pixels → zxing 1D barcode (Code-128 on Iranian bills).
// PDFs: pdfjs-dist renders pages at 300 DPI onto an @napi-rs/canvas surface,
// then the same barcode decode runs — matching the legacy PyMuPDF+pyzbar flow.
// Unlike pyzbar, zxing does not auto-rotate, so each source is tried at
// 0°/90°/270° (bills are often photographed with the barcode sideways).

import sharp from "sharp";
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  LuminanceSource,
  MultiFormatOneDReader,
} from "@zxing/library";
import type { BillNumbers } from "./billNumbers";
import { parseBillNumbers } from "./billNumbers";

class GraySource extends LuminanceSource {
  constructor(
    private readonly gray: Uint8ClampedArray,
    private readonly w: number,
    private readonly h: number,
  ) {
    super(w, h);
  }

  getRow(y: number, row?: Uint8ClampedArray): Uint8ClampedArray {
    const out = row && row.length >= this.w ? row : new Uint8ClampedArray(this.w);
    out.set(this.gray.subarray(y * this.w, y * this.w + this.w));
    return out;
  }

  getMatrix(): Uint8ClampedArray {
    return this.gray;
  }

  crop(left: number, top: number, width: number, height: number): LuminanceSource {
    const out = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) {
      out.set(this.gray.subarray((top + y) * this.w + left, (top + y) * this.w + left + width), y * width);
    }
    return new GraySource(out, width, height);
  }

  invert(): LuminanceSource {
    const out = new Uint8ClampedArray(this.gray.length);
    for (let i = 0; i < this.gray.length; i++) out[i] = 255 - this.gray[i];
    return new GraySource(out, this.w, this.h);
  }
}

function tryDecode(gray: Uint8ClampedArray, width: number, height: number): string[] {
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);
  const reader = new MultiFormatOneDReader(hints as Map<DecodeHintType, any>);
  const bitmap = new BinaryBitmap(new HybridBinarizer(new GraySource(gray, width, height)));
  try {
    const result = reader.decode(bitmap, hints as Map<DecodeHintType, any>);
    return result ? [result.getText()] : [];
  } catch {
    return []; // NotFoundException — no readable barcode
  }
}

/** 90° clockwise rotation of a grayscale buffer (zxing has no auto-rotation). */
function rotateGray90(src: Uint8ClampedArray, w: number, h: number): { gray: Uint8ClampedArray; w: number; h: number } {
  const out = new Uint8ClampedArray(w * h);
  const ow = h;
  const oh = w;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      out[y * ow + x] = src[(h - 1 - x) * w + y];
    }
  }
  return { gray: out, w: ow, h: oh };
}

function decodeAllOrientations(gray: Uint8ClampedArray, width: number, height: number): string[] {
  const candidates = [...tryDecode(gray, width, height)];
  if (candidates.length) return candidates;
  const r90 = rotateGray90(gray, width, height);
  candidates.push(...tryDecode(r90.gray, r90.w, r90.h));
  if (candidates.length) return candidates;
  const r180 = rotateGray90(r90.gray, r90.w, r90.h);
  candidates.push(...tryDecode(r180.gray, r180.w, r180.h));
  if (candidates.length) return candidates;
  const r270 = rotateGray90(r180.gray, r180.w, r180.h);
  candidates.push(...tryDecode(r270.gray, r270.w, r270.h));
  return candidates;
}

async function grayFromSharp(img: sharp.Sharp): Promise<{ gray: Uint8ClampedArray; width: number; height: number }> {
  const { data, info } = await img.rotate().greyscale().raw().toBuffer({ resolveWithObject: true });
  return { gray: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/** Decode a bill photo (jpg/png/webp/…). Returns null when no valid bill barcode found. */
export async function extractFromImage(imageBytes: Buffer): Promise<BillNumbers | null> {
  let base: { gray: Uint8ClampedArray; width: number; height: number };
  try {
    base = await grayFromSharp(sharp(imageBytes));
  } catch {
    return null;
  }
  let candidates = decodeAllOrientations(base.gray, base.width, base.height);
  let found = firstValidBillNumbers(candidates);
  if (found) return found;
  // Small photos may not have enough pixels per bar — one 2x upscale retry.
  if (base.width < 900) {
    const up = await grayFromSharp(sharp(imageBytes).rotate().greyscale().resize({ width: base.width * 2 }));
    found = firstValidBillNumbers(decodeAllOrientations(up.gray, up.width, up.height));
  }
  return found;
}

/** Decode a bill PDF by rasterizing up to 5 pages at 300 DPI (legacy behaviour). */
export async function extractFromPdf(pdfBytes: Buffer): Promise<BillNumbers | null> {
  let pdfjs: any;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    return null;
  }
  let doc: any;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(pdfBytes),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  } catch {
    return null;
  }
  try {
    const { createCanvas } = await import("@napi-rs/canvas");
    const pages = Math.min(doc.numPages, 5);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 300 / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // @napi-rs/canvas starts transparent-black; fill white like paper first.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = new Uint8ClampedArray(image.width * image.height);
      for (let p = 0, q = 0; p < image.data.length; p += 4, q++) {
        gray[q] = (image.data[p] * 299 + image.data[p + 1] * 587 + image.data[p + 2] * 114) / 1000;
      }
      const found = firstValidBillNumbers(decodeAllOrientations(gray, image.width, image.height));
      if (found) return found;
    }
  } catch {
    return null;
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
  return null;
}

function firstValidBillNumbers(candidates: string[]): BillNumbers | null {
  for (const raw of candidates) {
    try {
      return parseBillNumbers(raw);
    } catch {
      continue;
    }
  }
  return null;
}
