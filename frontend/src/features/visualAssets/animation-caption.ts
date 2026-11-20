export type CaptionPosition = "top" | "center" | "bottom";
export type CaptionSize = "small" | "medium" | "large";
export type AnimationCaption = {
  text: string;
  position: CaptionPosition;
  size: CaptionSize;
  rasterPng: string;
};

// Freeze the UI font's actual glyphs in the recipe. Preview and retries then
// render the same glyphs without requiring the same fonts on another device.
export function rasterizeCaption(text: string): string | null {
  const lines = text.split("\n");
  if (lines.length > 3 || Array.from(text).length > 120) return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = 'bold 48px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.font = font;
  const measured = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
  const scale = Math.min(1, 1008 / measured);
  const lineHeight = 66;
  canvas.width = Math.ceil(measured * scale) + 16;
  canvas.height = Math.ceil(lines.length * lineHeight * scale) + 12;
  ctx.translate(canvas.width / 2, 6);
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "black";
  ctx.fillStyle = "white";
  lines.forEach((line, index) => {
    const y = (index + 0.5) * lineHeight;
    ctx.strokeText(line, 0, y);
    ctx.fillText(line, 0, y);
  });
  const png = canvas.toDataURL("image/png").split(",")[1];
  return png && png.length <= 48 * 1024 ? png : null;
}
