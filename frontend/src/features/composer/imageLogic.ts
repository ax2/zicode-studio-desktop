export interface ImageItem {
  type: "image";
  data: string;
  mimeType: string;
}

export const MAX_IMAGE_DIMENSION = 2048;

const VALID_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function normalizeMimeType(type: string): string {
  return VALID_MIME_TYPES.has(type) ? type : "image/png";
}

export function defaultProcessImageFile(file: File): Promise<ImageItem> {
  return new Promise((resolve, reject) => {
    const mimeType = normalizeMimeType(file.type);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        let { width, height } = image;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Failed to encode image"));
          return;
        }
        context.drawImage(image, 0, 0, width, height);

        const outputMimeType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
        const quality = outputMimeType === "image/jpeg" ? 0.85 : undefined;
        const base64 = canvas.toDataURL(outputMimeType, quality).split(",")[1];
        if (!base64) {
          reject(new Error("Failed to encode image"));
          return;
        }
        resolve({ type: "image", data: base64, mimeType: outputMimeType });
      };
      image.onerror = () => reject(new Error("Failed to decode image"));
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function filterImageFiles(
  files: FileList | File[] | null | undefined,
): File[] {
  return Array.from(files ?? []).filter((file) => file?.type?.startsWith("image/"));
}
