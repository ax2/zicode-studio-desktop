import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { Blog, type Invoke, type Site } from "./index";

afterEach(cleanup);
it("reviews image-only changes for the open article and clears review when switching", async () => {
  setLocale("en");
  const site: Site = {
    root: "C:/fixture",
    paths: ["one.md", "two.md"],
    changedPaths: [],
    pendingPush: false,
    homepagePicks: false,
    gitAvailable: true,
  };
  const image = "@asset/public/heroes/one-hero.png";
  const requests: Record<string, unknown>[] = [];
  const invoke = vi.fn(async (request) => {
    requests.push(request);
    if (request.action === "read")
      return "---\ntitle: Example\nslug: one\npubDate: 2024-01-01\n---\n";
    if (request.action === "preview")
      return { paths: [image], deletions: [], sizes: { [image]: 1200 } };
    return site;
  }) as Invoke;
  const view = render(<Blog invoke={invoke} />);
  fireEvent.click(await view.findByText("one.md"));
  fireEvent.click(await view.findByText("Sync articles to GitHub"));
  fireEvent.click(view.getByRole("checkbox", { name: "one.md" }));
  fireEvent.click(view.getByText("Review files to sync"));
  expect(await view.findByText("public/heroes/one-hero.png")).toBeTruthy();
  expect(requests.at(-1)).toMatchObject({ action: "preview", paths: ["one.md"] });
  fireEvent.click(view.getByText("two.md"));
  await waitFor(() => expect(view.queryByText("public/heroes/one-hero.png")).toBeNull());
  expect(requests.some((r) => r.action === "push")).toBe(false);
});
it("keeps an unsaved edit when switching is declined and prevents pulling", async () => {
  setLocale("en");
  const site: Site = {
    root: "C:/fixture",
    paths: ["alpha.md"],
    changedPaths: [],
    pendingPush: false,
    homepagePicks: false,
    gitAvailable: true,
    catalog: { "alpha.md": { title: "API notes", categories: ["开发"], tags: ["Rust"] } },
  };
  const text = "---\ntitle: API notes\nslug: alpha\npubDate: 2024-01-01\n---\noriginal";
  const invoke = vi.fn(async (request) => (request.action === "read" ? text : site)) as Invoke;
  const view = render(<Blog invoke={invoke} />);
  fireEvent.change(await view.findByRole("searchbox"), { target: { value: "Rust" } });
  fireEvent.click(view.getByText("API notes"));
  fireEvent.change(await view.findByLabelText("Markdown text"), {
    target: { value: "draft-in-progress" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    fireEvent.click(view.getByText("New article"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((view.getByLabelText("Markdown text") as HTMLTextAreaElement).value).toBe(
      "draft-in-progress",
    );
    expect((view.getByText("Pull changes") as HTMLButtonElement).disabled).toBe(true);
  } finally {
    confirm.mockRestore();
  }
});
it("writes locally, then pushes only the article the author selects", async () => {
  setLocale("en");
  const site: Site = {
    root: "C:/test/astro",
    paths: [],
    changedPaths: [],
    homepagePicks: false,
    pendingPush: false,
    gitAvailable: true,
  };
  const requests: Record<string, unknown>[] = [];
  const invoke: Invoke = vi.fn(async (request) => {
    requests.push(request);
    if (request.action === "preview")
      return {
        paths: [
          "sample.md",
          "@asset/public/images/sample/diagram.webp",
          "@asset/public/images/sample/old.png",
        ],
        deletions: ["@asset/public/images/sample/old.png"],
        sizes: { "@asset/public/images/sample/diagram.webp": 2064 },
      };
    if (request.action === "save") {
      site.paths = ["sample.md"];
      site.changedPaths = ["sample.md", "other.md"];
      return request.text;
    }
    return { ...site };
  }) as Invoke;
  const view = render(<Blog invoke={invoke} />);
  fireEvent.click(await view.findByText("New article"));
  fireEvent.change(await view.findByLabelText("Title"), { target: { value: "Example" } });
  fireEvent.change(view.getByLabelText("Article slug"), { target: { value: "sample" } });
  fireEvent.change(view.getByLabelText("Markdown text"), {
    target: { value: "This is the body." },
  });
  fireEvent.click(view.getByText("Save article"));
  await view.findByText("Article saved locally");
  expect(requests.find((r) => r.action === "save")).toMatchObject({
    expected: null,
    path: "sample.md",
    site: site.root,
  });
  expect(requests.some((r) => r.action === "push")).toBe(false);
  fireEvent.click(view.getByText("Sync articles to GitHub"));
  fireEvent.click(view.getByRole("checkbox", { name: "sample.md" }));
  fireEvent.click(view.getByText("Review files to sync"));
  const push = await view.findByRole("button", { name: "Commit and push selected changes" });
  expect((push as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByText("public/images/sample/diagram.webp")).toBeTruthy();
  expect(view.queryByText("src/content/blog/other.md")).toBeNull();
  fireEvent.click(view.getByRole("checkbox", { name: /Confirm deletion.*old\.png/ }));
  fireEvent.click(push);
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      action: "push",
      owners: ["sample.md"],
      paths: [
        "sample.md",
        "@asset/public/images/sample/diagram.webp",
        "@asset/public/images/sample/old.png",
      ],
      deletions: ["@asset/public/images/sample/old.png"],
    }),
  );
});

it("uses Hugo fields for newly saved articles and previews the matching sync path", async () => {
  setLocale("en");
  const site: Site = {
    root: "C:/test/hugo",
    paths: [],
    changedPaths: [],
    homepagePicks: false,
    pendingPush: false,
    gitAvailable: true,
    framework: "hugo",
    collection: "content/posts",
  };
  const requests: Record<string, unknown>[] = [];
  const invoke = vi.fn(async (request) => {
    requests.push(request);
    if (request.action === "save") {
      site.paths = ["note.md"];
      site.changedPaths = ["note.md"];
      return request.text;
    }
    if (request.action === "preview") return { paths: ["note.md"], deletions: [] };
    return { ...site };
  }) as Invoke;
  const view = render(<Blog invoke={invoke} />);
  fireEvent.click(await view.findByText("New article"));
  fireEvent.change(await view.findByLabelText("Title"), { target: { value: "Note" } });
  fireEvent.change(view.getByLabelText("Article slug"), { target: { value: "note" } });
  fireEvent.change(view.getByLabelText("Categories (comma separated)"), {
    target: { value: "Docs" },
  });
  fireEvent.click(view.getByText("Save article"));
  await view.findByText("Article saved locally");
  const savedText = String(requests.find((r) => r.action === "save")?.text);
  expect(savedText).toMatch(/^draft: true$/m);
  expect(savedText).toMatch(/^categories:/m);
  expect(savedText).toMatch(/^date:/m);
  expect(savedText).not.toMatch(/^category:|^pubDate:/m);
  fireEvent.click(view.getByText("Sync articles to GitHub"));
  fireEvent.click(view.getByRole("checkbox", { name: "note.md" }));
  fireEvent.click(view.getByText("Review files to sync"));
  expect(await view.findByText("content/posts/note.md")).toBeTruthy();
  expect(requests.find((r) => r.action === "push")).toBeUndefined();
});
