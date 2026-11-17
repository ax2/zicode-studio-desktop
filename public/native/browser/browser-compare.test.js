import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../i18n.js";
import { browserComparisonPrompt } from "./browser-chat-draft.js";
import { createBrowserCompare } from "./browser-compare.js";

const capture = (title, text) => ({
  tab: title,
  documentRevision: 1,
  capturedAt: "2026-11-17T03:00:00Z",
  page: { title, url: `https://example.org/${title.toLowerCase()}`, text, selection: "", truncated: false },
});
const alder = capture("Alder", "37 calibration passes");
const birch = capture("Birch", "82 calibration passes");

function openCompare(current, peer, options) {
  const compare = createBrowserCompare({
    capture: current,
    peers: [{ tab: peer.tab, title: peer.page.title, url: peer.page.url }],
    readSource: async () => peer,
    sourcesAreCurrent: () => true,
    setBusy: () => {},
    isOpen: () => true,
    onPrepared: () => {},
    ...options,
  });
  document.body.append(compare.button, compare.panel);
  compare.button.click();
  getByRole(compare.panel, "checkbox").click();
  getByRole(compare.panel, "button", { name: t("Read selected tabs") }).click();
  return compare.panel;
}

afterEach(() => document.body.replaceChildren());

it("shows both original excerpts without an AI handler and renumbers when the current page changes", async () => {
  for (const [current, peer] of [[alder, birch], [birch, alder]]) {
    const panel = openCompare(current, peer);
    await waitFor(() => expect(panel.querySelectorAll(".browser-compare-preview > article")).toHaveLength(2));
    const cards = panel.querySelectorAll(".browser-compare-preview > article");
    for (const [index, source] of [current, peer].entries()) {
      expect(cards[index].querySelector("h3").textContent).toBe(`[${index + 1}] ${source.page.title}`);
      expect(cards[index].textContent).toContain(source.page.url);
      expect(getByRole(cards[index], "textbox").value).toBe(source.page.text);
    }
    expect(queryByRole(panel, "button", { name: t("Prepare AI comparison draft") })).toBeNull();
    panel.remove();
  }
});

it("uses the same source order in the draft only after explicit action", async () => {
  const prepare = vi.fn();
  const panel = openCompare(alder, birch, { prepare });
  await waitFor(() => expect(panel.querySelectorAll(".browser-compare-preview > article")).toHaveLength(2));
  expect(prepare).not.toHaveBeenCalled();
  getByRole(panel, "button", { name: t("Prepare AI comparison draft") }).click();
  expect(prepare).toHaveBeenCalledTimes(1);
  const sources = JSON.parse(browserComparisonPrompt(prepare.mock.calls[0][0]).split("\n\n")[2]).sources;
  expect(sources.map(({ citation, url }) => [citation, url])).toEqual([["[1]", alder.page.url], ["[2]", birch.page.url]]);
});

it.each([
  { readSource: async () => alder },
  { readSource: async () => ({ ...birch, documentRevision: undefined }) },
  { sourcesAreCurrent: () => false },
])("rejects a comparison with a missing, mismatched or stale source", async options => {
  const panel = openCompare(alder, birch, { prepare: vi.fn(), ...options });
  await waitFor(() => expect(getByRole(panel, "status").textContent).toBe(t("A selected tab changed. Reopen the page preview and try again.")));
  expect(panel.querySelectorAll(".browser-compare-preview > article")).toHaveLength(0);
  expect(getByRole(panel, "button", { name: t("Prepare AI comparison draft") }).disabled).toBe(true);
});
