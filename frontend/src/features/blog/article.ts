import { isMap, parseDocument } from "yaml";

export type Framework = "astro" | "hugo";

export type Article = {
  title: string;
  description: string;
  slug: string;
  pubDate: string;
  category: string[];
  tags: string[];
  draft: boolean;
  body: string;
};

export function blankArticle(framework: Framework = "astro"): Article {
  return {
    title: "",
    description: "",
    slug: "",
    pubDate: new Date().toISOString().slice(0, 10),
    category: [],
    tags: [],
    draft: framework === "hugo",
    body: "",
  };
}

function split(text: string) {
  const parts = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)^(---[ \t]*(?:\r?\n|$))([\s\S]*)$/m.exec(text);
  if (parts?.index !== 0) throw new Error("Invalid article frontmatter");
  const doc = parseDocument(parts[2], { uniqueKeys: true });
  if (!isMap(doc.contents) || doc.errors.length) throw new Error("Invalid article frontmatter");
  return { parts, doc, meta: doc.toJS({ maxAliasCount: 50 }) };
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

const metadataFields = {
  astro: { pubDate: "pubDate", category: "category" },
  hugo: { pubDate: "date", category: "categories" },
} as const;

export function readArticle(text: string, path: string, framework: Framework = "astro") {
  if (framework === "hugo" && !/^\uFEFF?---[ \t]*\r?\n/.test(text))
    throw new Error("blog_hugo_yaml_required");
  const fields = metadataFields[framework];
  const { parts, meta } = split(text);
  const filename = path.replace(/\.mdx?$/i, "");
  const slug = meta.slug ?? (framework === "hugo" ? filename.replace(/\/index$/, "") : filename);
  const article: Article = {
    title: String(meta.title ?? ""),
    description: String(meta.description ?? ""),
    slug: String(slug),
    pubDate: String(meta[fields.pubDate] ?? ""),
    category: strings(meta[fields.category]),
    tags: strings(meta.tags),
    draft: meta.draft === true,
    body: parts[4],
  };
  return { article, urlSlug: String(meta.urlSlug || slug) };
}

export function writeArticle(
  original: string | null,
  path: string,
  next: Article,
  framework: Framework = "astro",
): string {
  if (!next.title.trim() || !next.slug.trim() || (framework === "astro" && !next.pubDate.trim()))
    throw new Error("Title, slug and date are required");
  if (next.pubDate.trim() && !Number.isFinite(Date.parse(next.pubDate)))
    throw new Error("Invalid publication date");
  const source = original ?? "---\n{}\n---\n";
  const before = original === null ? null : readArticle(original, path, framework).article;
  const { parts, doc } = split(source);
  if (original === null && isMap(doc.contents)) doc.contents.flow = false;
  const fields = metadataFields[framework];
  let changed = false;
  for (const key of [
    "title",
    "description",
    "slug",
    "pubDate",
    "category",
    "tags",
    "draft",
  ] as const) {
    if (before && JSON.stringify(before[key]) === JSON.stringify(next[key])) continue;
    const name = key === "pubDate" || key === "category" ? fields[key] : key;
    if (key === "pubDate" && !next.pubDate.trim()) doc.delete(name);
    else doc.set(name, next[key]);
    changed = true;
  }
  const newline = parts[1].includes("\r\n") ? "\r\n" : "\n";
  const yaml = changed ? doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, newline) : parts[2];
  const body =
    before && next.body === before.body ? next.body : next.body.replace(/\r?\n/g, newline);
  return parts[1] + yaml + parts[3] + (!parts[3].endsWith("\n") && body ? newline : "") + body;
}

// Only edit the site's literal string list. Never execute the site's TypeScript.
export function homepagePicks(source: string) {
  const declaration = /^export const HOME_PICKS(?:\s*:\s*string\[\])?\s*=\s*\[\s*\r?\n/m.exec(
    source,
  );
  if (!declaration) throw new Error("Unsupported homepage recommendation format");
  const start = declaration.index + declaration[0].length;
  const tail = source.slice(start);
  const closing = /^\s*\];?[ \t]*$/m.exec(tail);
  if (!closing) throw new Error("Unsupported homepage recommendation format");
  const rows = tail.slice(0, closing.index).match(/[^\n]*(?:\n|$)/g) ?? [];
  const parsed = rows.map((line) => {
    if (!line.trim() || line.trimStart().startsWith("//")) return { line, slug: null };
    const slug = /^\s*(['"])([^'"\\\r\n]+)\1\s*,?\s*(?:\/\/[^\n]*)?$/.exec(line.trimEnd())?.[2];
    if (!slug) throw new Error("Unsupported homepage recommendation format");
    return { line, slug };
  });
  const slugs = parsed.flatMap((r) => (r.slug ? [r.slug] : []));
  return {
    slugs,
    toggle(slug: string) {
      if (!slug || /['"\\\r\n]/.test(slug)) throw new Error("Unsupported recommendation slug");
      const newline = declaration[0].endsWith("\r\n") ? "\r\n" : "\n";
      const body = parsed
        .filter((r) => r.slug !== slug)
        .map((r) => r.line)
        .join("");
      const append = !slugs.includes(slug);
      // Add at the beginning so an explicitly recommended article is visible in the hero.
      return (
        source.slice(0, start) +
        (append ? `\t'${slug}',${newline}` : "") +
        body +
        tail.slice(closing.index)
      );
    },
  };
}
