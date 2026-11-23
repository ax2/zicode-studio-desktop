import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { Blog, type Invoke, type Site } from "./index";

afterEach(cleanup);
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
  fireEvent.change(await view.findByLabelText("Markdown"), {
    target: { value: "draft-in-progress" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    fireEvent.click(view.getByText("New article"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((view.getByLabelText("Markdown") as HTMLTextAreaElement).value).toBe(
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
  fireEvent.change(view.getByLabelText("Markdown"), { target: { value: "This is the body." } });
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
  fireEvent.click(view.getByText("Commit and push selected changes"));
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ action: "push", paths: ["sample.md"] }),
  );
});
