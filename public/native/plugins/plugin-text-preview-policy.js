// Only an exactly negotiated Host execution profile enables the larger text view.
export const textPreviewLimit = profile => profile === "resource.wasi.markdown.v1" ? 16 * 1024 * 1024
  : ["resource.wasi.regex.replace.v1", "resource.wasi.regex.review.v1"].includes(profile) ? 2 * 1024 * 1024 : 128 * 1024;
