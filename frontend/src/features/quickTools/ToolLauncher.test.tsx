import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { QuickToolLinks } from "./QuickToolLinks";
import type { LauncherResult, ToolLauncherApi } from "./ToolLauncher";
import type { DirectoryItem } from "../toolCenter/manual-tools";

afterEach(cleanup);

const encoder: DirectoryItem = {
  accessId: "provider:encoder", toolId: "provider:encoder", capabilityId: "encoder", pluginId: "provider",
  title: "Base64 Encoder", applicationName: "DevTools", publisher: "Local", version: "1.0.0",
  enabled: true, runtime: "wasi", categoryId: "text",
};
const page = (items: DirectoryItem[] = [], nextOffset: number | null = null): LauncherResult => ({
  page: { items, total: nextOffset ? 41 : items.length, revision: "rev", nextOffset, accessRevision: 3 },
  scope: { sceneId: "programming", workspaceId: "workspace" }, generation: 1, favoriteIds: [], recentIds: [],
});
function fixture(overrides: Partial<ToolLauncherApi> = {}) {
  return {
    applications: () => [{ id: "local.clipboard:open", label: "Clipboard", category: "Text and language", source: "Studio",
      keywords: ["剪贴板"], action: () => undefined }],
    search: vi.fn<ToolLauncherApi["search"]>(async () => page()),
    open: vi.fn(async () => true),
    openApplication: vi.fn(async () => true),
    setFavorite: vi.fn(async () => undefined),
    ...overrides,
  };
}
async function launcher(api: ToolLauncherApi) {
  const view = render(<><QuickToolLinks compact launcher={api} /><button type="button">Outside</button></>);
  const summary = view.container.querySelector("summary") as HTMLElement;
  const details = summary.parentElement as HTMLDetailsElement;
  summary.focus();
  fireEvent.keyDown(summary, { key: "ArrowDown" });
  const input = await screen.findByRole("searchbox");
  expect(document.activeElement).toBe(input);
  return { summary, details, input };
}

it("defaults to translation, opens it without searching or invoking a tool, and restores keyboard focus", async () => {
  const api = fixture();
  const { input, summary, details } = await launcher(api);
  const translation = vi.fn();
  window.addEventListener("zicode:open-translation", translation, { once: true });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const first = details.querySelector("[data-tool-launcher-open]");
  expect(document.activeElement).toBe(first);
  expect(first?.textContent).toBe(t("Translate"));
  fireEvent.click(first as Element);
  expect(translation).toHaveBeenCalledOnce();
  expect(api.search).not.toHaveBeenCalled();
  expect(api.open).not.toHaveBeenCalled();
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

it("searches applications by alias and sends Enter directly to the matched application", async () => {
  const api = fixture();
  const { input, details } = await launcher(api);
  fireEvent.change(input, { target: { value: "剪贴板" } });
  await waitFor(() => expect(api.search).toHaveBeenCalledOnce());
  await waitFor(() => expect(details.querySelector('[aria-busy="false"]')).toBeTruthy());
  fireEvent.keyDown(input, { key: "Enter" });
  expect(api.openApplication).toHaveBeenCalledWith("local.clipboard:open");
  await waitFor(() => expect(details.open).toBe(false));
});

it("pages through Host results, pins an exact identity, and opens the selected form", async () => {
  const api = fixture();
  const first = page([], 40), second = page([encoder]);
  vi.mocked(api.search).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const { input } = await launcher(api);
  fireEvent.click(screen.getByRole("button", { name: t("All tools") }));
  const next = await screen.findByRole("button", { name: t("Next page") });
  fireEvent.click(next);
  expect(document.activeElement).toBe(input);
  await waitFor(() => expect(api.search).toHaveBeenLastCalledWith("all", "", { offset: 40, revision: "rev", accessRevision: 3 }, expect.any(AbortSignal)));
  fireEvent.click(await screen.findByRole("button", { name: `${t("Favorite")}: Base64 Encoder` }));
  expect(api.setFavorite).toHaveBeenCalledWith(encoder.accessId, true, second);
  fireEvent.click(screen.getByRole("button", { name: "Base64 Encoder DevTools" }));
  expect(api.open).toHaveBeenCalledWith(encoder, second);
});

it("uses Host categories to keep browsing bounded without filtering only the currently visible items", async () => {
  const api = fixture();
  const initial = page([], 40);
  initial.page.categories = [{ id: "text", count: 41 }];
  vi.mocked(api.search).mockResolvedValueOnce(initial).mockResolvedValueOnce(page([encoder]));
  await launcher(api);
  fireEvent.click(screen.getByRole("button", { name: t("All tools") }));
  await screen.findByRole("option", { name: t("Text tools") });
  fireEvent.change(screen.getByRole("combobox", { name: t("Category") }), { target: { value: "text" } });
  await screen.findByText(encoder.title);
  expect(api.search).toHaveBeenLastCalledWith("all", "", { offset: 0, revision: null, categoryId: "text" }, expect.any(AbortSignal));
  expect(screen.queryByText("Clipboard")).toBeNull();
});

it("aborts stale queries and never opens late results after the target changes", async () => {
  const api = fixture();
  let settle: (response: LauncherResult) => void = () => {};
  vi.mocked(api.search).mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
  const { input, details } = await launcher(api);
  fireEvent.change(input, { target: { value: "base64" } });
  await waitFor(() => expect(api.search).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.search).mock.calls[0][3];
  await act(async () => window.dispatchEvent(new Event("zicode:tool-target-changed")));
  await act(async () => settle(page([encoder])));
  await waitFor(() => expect(signal.aborted).toBe(true));
  expect(details.open).toBe(false);
  expect(screen.queryByText("Base64 Encoder")).toBeNull();
  expect(api.open).not.toHaveBeenCalled();
});

it("does not report an empty search when an application or translation matches", async () => {
  const api = fixture();
  const { input } = await launcher(api);
  for (const query of ["Clipboard", "翻译"]) {
    fireEvent.change(input, { target: { value: query } });
    await waitFor(() => expect(api.search).toHaveBeenLastCalledWith("all", query, { offset: 0, revision: null }, expect.any(AbortSignal)));
    await waitFor(() => expect(document.querySelector('.tool-launcher-results[aria-busy="false"]')).not.toBeNull());
    expect(screen.queryByText(t("No matching tools"))).toBeNull();
  }
  fireEvent.change(input, { target: { value: "no-such-entry" } });
  await screen.findByText(t("No matching tools"));
});

it("keeps directory failures visible even when a local application matches", async () => {
  const api = fixture();
  vi.mocked(api.search).mockRejectedValueOnce(new Error("Host unavailable"));
  const { input } = await launcher(api);
  fireEvent.change(input, { target: { value: "Clipboard" } });
  await screen.findByRole("alert");
  expect(screen.queryByText(t("No matching tools"))).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clipboard " + t("Text and language") }));
  expect(api.openApplication).toHaveBeenCalledWith("local.clipboard:open");
});

it("traverses a 125-entry directory without losing page identities or reopening an old result", async () => {
  const api = fixture();
  const entries = Array.from({ length: 125 }, (_, index) => ({
    ...encoder, accessId: "provider:tool-" + index, toolId: "provider:tool-" + index, title: "Tool " + index,
  }));
  vi.mocked(api.search).mockImplementation(async (_view, _query, cursor) => page(
    entries.slice(cursor.offset, cursor.offset + 40), cursor.offset + 40 < entries.length ? cursor.offset + 40 : null,
  ));
  const { input } = await launcher(api);
  fireEvent.change(input, { target: { value: "Tool" } });
  for (const offset of [0, 40, 80, 120]) {
    await screen.findByRole("button", { name: "Tool " + offset + " DevTools" });
    const current = document.querySelectorAll('.tool-launcher-tile [data-tool-launcher-open]');
    expect(current).toHaveLength(Math.min(40, entries.length - offset));
    if (offset < 120) fireEvent.click(screen.getByRole("button", { name: t("Next page") }));
  }
  expect(screen.getByRole<HTMLButtonElement>("button", { name: t("Next page") }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Tool 124 DevTools" }));
  expect(api.open).toHaveBeenCalledWith(entries[124], expect.objectContaining({
    page: expect.objectContaining({ items: entries.slice(120) }),
  }));
});

it("shows translation in its saved recent position and opens it without executing a tool", async () => {
  const api = fixture();
  const applications = api.applications();
  api.applications = () => [...applications, { id: "com.zicode.translate:open", label: t("Translate"),
    category: "Text and language", source: "Studio", action: () => undefined }];
  const response = page();
  response.recentIds = ["local.clipboard:open", "com.zicode.translate:open"];
  vi.mocked(api.search).mockResolvedValue(response);
  await launcher(api);
  fireEvent.click(screen.getByRole("button", { name: t("Recently used tools") }));
  await screen.findByRole("button", { name: t("Translate") });
  const ids = [...document.querySelectorAll<HTMLElement>("[data-tool-launcher-open]")]
    .map(element => element.dataset.toolLauncherOpen);
  expect(ids).toEqual(response.recentIds);
  const opened = vi.fn();
  window.addEventListener("zicode:open-translation", opened, { once: true });
  fireEvent.click(screen.getByRole("button", { name: t("Translate") }));
  expect(opened).toHaveBeenCalledOnce();
  expect(api.open).not.toHaveBeenCalled();
  expect(api.openApplication).not.toHaveBeenCalled();
});

it("does not invent a recent translation entry before it has been opened", async () => {
  const api = fixture({ applications: () => [{ id: "com.zicode.translate:open", label: t("Translate"),
    category: "Text and language", source: "Studio", action: () => undefined }] });
  await launcher(api);
  fireEvent.click(screen.getByRole("button", { name: t("Recently used tools") }));
  await screen.findByText(t("No matching tools"));
  expect(screen.queryByRole("button", { name: t("Translate") })).toBeNull();
});

it("keeps the current all-tools page after saving a favorite while refreshing the saved state", async () => {
  const api = fixture();
  let pinned = false;
  vi.mocked(api.search).mockImplementation(async (_view, _query, cursor) => {
    const result = cursor.offset ? page([encoder]) : page([], 40);
    result.favoriteIds = pinned ? [encoder.accessId] : [];
    return result;
  });
  vi.mocked(api.setFavorite).mockImplementation(async () => {
    pinned = true;
    window.dispatchEvent(new Event("zicode:tool-access-changed"));
  });
  await launcher(api);
  fireEvent.click(screen.getByRole("button", { name: t("All tools") }));
  fireEvent.click(await screen.findByRole("button", { name: t("Next page") }));
  fireEvent.click(await screen.findByRole("button", { name: `${t("Favorite")}: Base64 Encoder` }));
  const saved = await screen.findByRole("button", { name: `${t("Remove favorite")}: Base64 Encoder` });
  expect(saved.getAttribute("aria-pressed")).toBe("true");
  expect(api.search).toHaveBeenLastCalledWith("all", "", { offset: 40, revision: "rev", accessRevision: 3 }, expect.any(AbortSignal));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: t("Previous page") }).disabled).toBe(false);
});

it.each(["剪贴板", "翻译"])("opens the current local match while the tool directory waits: %s", async query => {
  const api = fixture();
  vi.mocked(api.search).mockImplementation(() => new Promise(() => {}));
  const { input, details } = await launcher(api);
  const translation = vi.fn();
  window.addEventListener("zicode:open-translation", translation, { once: true });
  try {
    fireEvent.change(input, { target: { value: query } });
    await waitFor(() => expect(api.search).toHaveBeenCalledOnce());
    expect(details.querySelector('.tool-launcher-results[aria-busy="true"]')).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(api.openApplication).not.toHaveBeenCalled();
    expect(translation).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    if (query === "翻译") expect(translation).toHaveBeenCalledOnce();
    else expect(api.openApplication).toHaveBeenCalledExactlyOnceWith("local.clipboard:open");
    expect(api.open).not.toHaveBeenCalled();
    await waitFor(() => expect(details.open).toBe(false));
  } finally {
    window.removeEventListener("zicode:open-translation", translation);
  }
});
