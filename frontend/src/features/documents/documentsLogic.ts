// Shared helpers for the Documents feature.

export interface DocumentImportResult {
  ok: boolean;
  markdown: string;
  title: string;
  fileName: string;
  kind: string;
  charCount: number;
}

export function isSupportedDocument(name: string): boolean {
  return /\.(pdf|docx)$/i.test(name);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Cannot read file"));
      }
    };
    reader.onerror = () => reject(new Error("Cannot read file"));
    reader.readAsDataURL(file);
  });
}
