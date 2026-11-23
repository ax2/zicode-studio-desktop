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
