// Bound dimensions before entering browser codecs. Decode to a new static PNG for display.
const MAX_SIDE = 4096;
const MAX_PIXELS = 4 * 1024 * 1024;
const fail = () => { throw new Error("preview_image_invalid"); };
const tag = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
export function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === "image/png") {
    if (bytes.length < 45 || tag(bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") fail();
    let cursor = 8, chunks = 0, ended = false, pixels = false;
    while (cursor + 12 <= bytes.length && ++chunks <= 4096) {
      const size = view.getUint32(cursor), type = tag(bytes, cursor + 4, 4);
      if (size > bytes.length - cursor - 12 || ended || ["acTL", "fcTL", "fdAT"].includes(type)) fail();
      if (chunks === 1) {
        if (type !== "IHDR" || size !== 13) fail();
        width = view.getUint32(cursor + 8); height = view.getUint32(cursor + 12);
      } else if (type === "IHDR") fail();
      if (type === "IDAT") pixels = true;
      if (type === "IEND") { if (size !== 0) fail(); ended = true; }
      cursor += 12 + size;
    }
    if (!ended || !pixels || cursor !== bytes.length) fail();
  } else if (mime === "image/jpeg") {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 ||
      bytes.at(-2) !== 255 || bytes.at(-1) !== 217) fail();
    let cursor = 2, segments = 0;
    while (cursor + 4 <= bytes.length && ++segments <= 2048) {
      if (bytes[cursor++] !== 255) fail();
      while (bytes[cursor] === 255) cursor++;
      const marker = bytes[cursor++];
      if (marker === 218) break;
      if (cursor + 2 > bytes.length) fail();
      const size = view.getUint16(cursor);
      if (size < 2 || cursor + size > bytes.length) fail();
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (width || size < 8 || bytes[cursor + 2] !== 8) fail();
        height = view.getUint16(cursor + 3); width = view.getUint16(cursor + 5);
      }
      cursor += size;
    }
  } else if (mime === "image/webp") {
    if (bytes.length < 20 || tag(bytes, 0, 4) !== "RIFF" || tag(bytes, 8, 4) !== "WEBP" ||
      view.getUint32(4, true) !== bytes.length - 8) fail();
    let cursor = 12, frames = 0, chunks = 0, canvas = null;
    while (cursor + 8 <= bytes.length && ++chunks <= 4096) {
      const type = tag(bytes, cursor, 4), size = view.getUint32(cursor + 4, true), start = cursor + 8;
      if (size > bytes.length - start || type === "ANIM" || type === "ANMF") fail();
      if (type === "VP8X") {
        if (size !== 10 || canvas || (bytes[start] & 2)) fail();
        const u24 = (offset) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
        canvas = [u24(start + 4) + 1, u24(start + 7) + 1];
      } else if (type === "VP8 ") {
        if (++frames !== 1 || size < 10 || tag(bytes, start + 3, 3) !== "\x9d\x01\x2a") fail();
        width = view.getUint16(start + 6, true) & 16383; height = view.getUint16(start + 8, true) & 16383;
      } else if (type === "VP8L") {
        if (++frames !== 1 || size < 5 || bytes[start] !== 47) fail();
        const bits = view.getUint32(start + 1, true);
        width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1;
      }
      cursor = start + size + (size % 2);
    }
    if (cursor !== bytes.length || frames !== 1 || (canvas && (canvas[0] !== width || canvas[1] !== height))) fail();
  } else fail();
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) fail();
  return { width, height };
}

export async function decodeResourceImage(bytes, mime, isCurrent) {
  const dimensions = imageDimensions(bytes, mime);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  let canvas;
  try {
    if (!isCurrent() || !bitmap.width || !bitmap.height || bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE ||
      bitmap.width * bitmap.height > MAX_PIXELS || bitmap.width * bitmap.height !== dimensions.width * dimensions.height) fail();
    canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) fail();
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0; canvas.height = 0;
    if (!blob || !isCurrent()) fail();
    return { kind: "image", blob, width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
