import { imageDimensions } from "../../../../public/native/plugins/plugin-resource-image.js";

export interface InlineToolImage {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: "image/png";
  width: number;
  height: number;
}

// Read only an inline PNG already returned by the tool. Never follow a URL or file path.
export function inlineToolImage(text: string): InlineToolImage | null {
  if (text.length > 1024 * 1024) return null;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || value.ok === false ||
      typeof value.dataUrl !== "string" || (value.mimeType !== undefined && value.mimeType !== "image/png")) return null;
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.dataUrl);
    if (!match || match[1].length % 4 !== 0) return null;
    const bytes = Uint8Array.from(atob(match[1]), character => character.charCodeAt(0));
    const { width, height } = imageDimensions(bytes, "image/png");
    if ((value.width !== undefined && value.width !== width) || (value.height !== undefined && value.height !== height)) return null;
    return { bytes, width, height, mimeType: "image/png" };
  } catch { return null; }
}
