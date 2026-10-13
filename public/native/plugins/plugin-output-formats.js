// Mirrors src-tauri/src/plugin_output_types.rs. Unknown types never gain a file extension.
export const OUTPUT_EXTENSIONS = Object.freeze({
  "application/octet-stream": "bin",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
  "application/x-zicode-archive-zip": "zip",
  "application/x-zicode-archive-sevenzip": "7z",
  "application/x-zicode-archive-tar": "tar",
  "application/x-zicode-archive-targzip": "tar.gz",
  "application/x-zicode-archive-tarzstd": "tar.zst",
  "application/x-zicode-archive-tarxz": "tar.xz",
  "application/x-zicode-archive-tarlzma": "tar.lzma",
  "application/x-zicode-archive-tarbzip2": "tar.bz2",
  "application/x-zicode-archive-tarlz4": "tar.lz4",
  "application/x-zicode-archive-gzip": "gz",
  "application/x-zicode-archive-zstandard": "zst",
  "application/x-zicode-archive-xz": "xz",
  "application/x-zicode-archive-lzma": "lzma",
  "application/x-zicode-archive-bzip2": "bz2",
  "application/x-zicode-archive-lz4": "lz4",
  "application/x-zicode-archive-brotli": "br",
  "application/x-zicode-archive-rar": "rar",
  "application/x-zicode-archive-cab": "cab",
});

export function outputExtension(mime) {
  return Object.hasOwn(OUTPUT_EXTENSIONS, mime) ? OUTPUT_EXTENSIONS[mime] : undefined;
}

export function isBinaryOutput(mime) {
  return mime === "application/octet-stream" || mime.startsWith("application/x-zicode-archive-");
}
