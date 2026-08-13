// Shared helpers for the OCR feature.

export interface OcrResult {
  ok: boolean;
  text: string;
  charCount: number;
}

export const OCR_LANGUAGES = [
  { id: "", name: "Auto-detect" },
  { id: "en-US", name: "English" },
  { id: "zh-CN", name: "Chinese" },
  { id: "ja-JP", name: "Japanese" },
];

export function downscaleImage(file: File, maxEdge = 2400): Promise<string> {
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
