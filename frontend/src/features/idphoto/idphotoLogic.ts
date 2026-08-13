// ID photo templates and print-sheet specs (kept in sync with the Rust
// engine in src-tauri/src/idphoto.rs). Display names are t() keys so the UI
// stays bilingual.

import { t } from "../../shared/i18n";

export interface IdPhotoTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export interface PrintSheet {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export const IDPHOTO_TEMPLATES: IdPhotoTemplate[] = [
  { id: "one_inch", name: "1-inch", widthMm: 25, heightMm: 35 },
  { id: "small_one_inch", name: "Small 1-inch", widthMm: 22, heightMm: 32 },
  { id: "large_one_inch", name: "Large 1-inch", widthMm: 33, heightMm: 48 },
  { id: "two_inch", name: "2-inch", widthMm: 35, heightMm: 49 },
  { id: "small_two_inch", name: "Small 2-inch", widthMm: 35, heightMm: 45 },
  { id: "visa", name: "Visa", widthMm: 33, heightMm: 48 },
  { id: "passport", name: "Passport", widthMm: 33, heightMm: 48 },
  { id: "driving", name: "Driving license", widthMm: 22, heightMm: 32 },
  { id: "us_visa", name: "US visa", widthMm: 51, heightMm: 51 },
];

export const IDPHOTO_SHEETS: PrintSheet[] = [
  { id: "5inch", name: "5-inch", widthMm: 89, heightMm: 127 },
  { id: "6inch", name: "6-inch", widthMm: 102, heightMm: 152 },
  { id: "a4", name: "A4", widthMm: 210, heightMm: 297 },
];

export const IDPHOTO_BACKGROUNDS: Array<{ id: string; name: string }> = [
  { id: "keep", name: "Keep original" },
  { id: "white", name: "White" },
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
  { id: "lightblue", name: "Light blue" },
];

export function templateById(id: string): IdPhotoTemplate | undefined {
  return IDPHOTO_TEMPLATES.find((template) => template.id === id);
}

export function sheetById(id: string): PrintSheet | undefined {
  return IDPHOTO_SHEETS.find((sheet) => sheet.id === id);
}

/** Downscale an image file to a max edge (default 2048px) as a PNG data URL. */
export function downscaleImage(file: File, maxEdge = 2048): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Cannot read image file"));
    };
    image.src = url;
  });
}

export function formatMillimeters(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}mm`;
}

export function formatResultSize(result: {
  widthMm?: number;
  heightMm?: number;
  cols?: number;
  rows?: number;
}): string {
  const width = result.widthMm ?? 0;
  const height = result.heightMm ?? 0;
  const cols = result.cols ?? 0;
  const rows = result.rows ?? 0;
  return t("Layout: {cols} cols × {rows} rows · {count} photos")
    .replace("{cols}", String(cols))
    .replace("{rows}", String(rows))
    .replace("{count}", String(cols * rows));
}
