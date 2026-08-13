// Shared constants and helpers for the Image Tools feature.

export interface ImageToolResult {
  ok: boolean;
  fileName?: string;
  url?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

export const OUTPUT_FORMATS = [
  { id: "png", name: "PNG" },
  { id: "jpeg", name: "JPEG" },
  { id: "webp", name: "WebP" },
];

export const FIT_MODES = [
  { id: "contain", name: "Contain" },
  { id: "cover", name: "Cover" },
  { id: "stretch", name: "Stretch" },
];

export const ROTATIONS = [0, 90, 180, 270];

export const FLIPS = [
  { id: "none", name: "None" },
  { id: "horizontal", name: "Horizontal" },
  { id: "vertical", name: "Vertical" },
  { id: "both", name: "Both" },
];

/** Downscale an image file so its longest edge is at most maxEdge px, returning a PNG data URL. */
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

export function formatBytes(bytes: number | undefined): string {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB"];
  let unit = 0;
  let size = value;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}
