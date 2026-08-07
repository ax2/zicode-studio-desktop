export interface FileEntry {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  size?: number;
}

export function fileIcon(entry: FileEntry): string {
  if (entry.kind === "directory") return "📁";
  if (entry.name === "Dockerfile" || entry.name.startsWith("Dockerfile.")) return "🐳";
  if (entry.name === ".gitignore" || entry.name === ".gitattributes") return "🔧";

  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "📜", ts: "📜", jsx: "📜", tsx: "📜", mjs: "📜", cjs: "📜",
    json: "📋", yaml: "📋", yml: "📋", toml: "📋", xml: "📋", csv: "📋",
    md: "📝", mdx: "📝", txt: "📝", rst: "📝",
    css: "🎨", scss: "🎨", sass: "🎨", less: "🎨",
    html: "🌐", htm: "🌐", svg: "🌐",
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", ico: "🖼️", bmp: "🖼️",
    mp4: "🎬", mov: "🎬", avi: "🎬", webm: "🎬", mkv: "🎬",
    mp3: "🎵", wav: "🎵", ogg: "🎵", flac: "🎵", aac: "🎵",
    zip: "📦", tar: "📦", gz: "📦", bz2: "📦", rar: "📦", "7z": "📦",
    pdf: "📕",
    rs: "🦀", py: "🐍", rb: "💎", go: "🔵", java: "☕", kt: "🟣", swift: "🔶",
    c: "⚙️", cpp: "⚙️", h: "⚙️", hpp: "⚙️",
    sh: "⚡", bash: "⚡", zsh: "⚡", fish: "⚡", ps1: "⚡",
    lock: "🔒", env: "🔑",
  };
  return map[ext] ?? "📄";
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
