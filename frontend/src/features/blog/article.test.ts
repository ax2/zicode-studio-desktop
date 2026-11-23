import { expect, it } from "vitest";
import { blankArticle, homepagePicks, readArticle, writeArticle } from "./article";

const source =
  "---\r\ntitle: '示例' # 保留注释\r\nslug: test\r\nurlSlug: override\r\npubDate: 2024-01-01\r\ncategory: 分类\r\ncustom:\r\n  keep: true\r\n---\r\n正文\r\n---\r\n";
it("preserves untouched frontmatter byte-for-byte during a body edit", () => {
  const { article, urlSlug } = readArticle(source, "test.mdx");
  expect(urlSlug).toBe("override");
  expect(writeArticle(source, "test.mdx", { ...article, body: "new\nbody\n" })).toBe(
    source.replace("正文\r\n---", "new\r\nbody"),
  );
});
it("retains unfamiliar metadata and comments when editing taxonomy", () => {
  const { article } = readArticle(source, "test.mdx");
  const updated = writeArticle(source, "test.mdx", {
    ...article,
    category: ["一", "二"],
    tags: ["标签"],
  });
  expect(updated).toContain("keep: true");
  expect(updated).toContain("# 保留注释");
  expect(readArticle(updated, "test.mdx").article.category).toEqual(["一", "二"]);
});
it("creates a Chinese article with the fields required by the Astro site", () => {
  const article = {
    ...blankArticle(),
    title: "示例",
    slug: "sample",
    description: "简介",
    body: "# 正文",
  };
  expect(readArticle(writeArticle(null, "sample.md", article), "sample.md").article).toEqual(
    article,
  );
});
it("updates literal homepage picks without evaluating or rewriting other source", () => {
  const raw =
    "// list\r\nexport const HOME_PICKS: string[] = [\r\n\t// note\r\n\t'alpha',\r\n];\r\n";
  const added = homepagePicks(raw).toggle("beta");
  expect(homepagePicks(added).slugs).toEqual(["beta", "alpha"]);
  expect(homepagePicks(added).toggle("beta")).toBe(raw);
  expect(() => homepagePicks(raw.replace("'alpha'", "getSlug()"))).toThrow();
});

it("preserves Hugo YAML metadata and writes Hugo taxonomy fields", () => {
  const source =
    "\uFEFF---\r\ntitle: Hugo guide\r\n# Keep this comment\r\ncategories: [Docs, Windows]\r\ntags: [Studio]\r\ndraft: false\r\nparams:\r\n  fixture: custom\r\n---\r\nGuide\r\n";
  const path = "guide/index.md";
  const { article } = readArticle(source, path, "hugo");
  expect(article).toMatchObject({ slug: "guide", category: ["Docs", "Windows"], pubDate: "" });
  expect(writeArticle(source, path, article, "hugo")).toBe(source);
  const changed = writeArticle(
    source,
    path,
    { ...article, category: ["Notes"], draft: true },
    "hugo",
  );
  expect(changed).toContain("# Keep this comment\r\n");
  expect(changed).toContain("params:\r\n  fixture: custom\r\n");
  expect(readArticle(changed, path, "hugo").article.category).toEqual(["Notes"]);
  expect(readArticle(changed, path, "hugo").article.draft).toBe(true);
  expect(changed).not.toMatch(/^category:|^pubDate:/m);
});

it("starts new Hugo articles as drafts and refuses unsupported metadata", () => {
  const article = {
    ...blankArticle("hugo"),
    title: "Studio draft",
    slug: "studio-draft",
    pubDate: "2025-04-05",
  };
  const rendered = writeArticle(null, "studio-draft.md", article, "hugo");
  expect(rendered).toMatch(/^date: 2025-04-05$/m);
  expect(rendered).toMatch(/^draft: true$/m);
  expect(() => readArticle('+++\ntitle = "TOML post"\n+++\n', "toml.md", "hugo")).toThrow(
    "blog_hugo_yaml_required",
  );
  expect(() => readArticle('{"title":"JSON post"}\n', "json.md", "hugo")).toThrow(
    "blog_hugo_yaml_required",
  );
});
