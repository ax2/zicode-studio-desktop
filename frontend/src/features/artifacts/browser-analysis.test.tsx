import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ArtifactMain } from "./ArtifactApp";
import { type ArtifactAppOptions, createArtifactStore } from "./store";
// @ts-expect-error plain JS modules without type declarations
import { navigateToBrowserSource } from "../../../../public/native/features/browser-source-navigation.js";
// @ts-expect-error plain JS module without type declarations
import { setupBrowserApp } from "../../../../public/native/browser/browser-app.js";
import fixture from "../../../../tests/fixtures/browser-analysis-artifact.json";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

it("reopens the saved browser result with readable source metadata and inert model text", async () => {
  setLocale("en");
  const document = { ...fixture, id: "saved", handle: "artifact:saved", sceneId: "programming",
    summary: "", createdAt: "2026-11-18T06:02:00Z", size: 512, version: "version" };
  const gateway = { get: vi.fn(async () => ({ artifact: document })),
    list: vi.fn(async () => ({ snapshot: { artifacts: [document] } })), importAll: vi.fn(), delete: vi.fn() };
  const store = createArtifactStore({ gateway, getTarget: () => ({ sceneId: "programming", workspaceId: "11111111-1111-4111-8111-111111111111" }) });
  await store.getState().openArtifact("saved");
  const result = render(<ArtifactMain store={store} />);
  expect(screen.getByRole("heading", { name: fixture.title })).toBeTruthy();
  const content = result.container.querySelector(".artifacts-content pre");
  expect(content?.textContent).toBe(fixture.content);
  expect(result.container.querySelector("script")).toBeNull();
  expect(result.container.querySelector(".artifacts-provenance")?.textContent).toContain(fixture.provenance.source.url);
  expect(gateway.get).toHaveBeenCalledWith("programming", "11111111-1111-4111-8111-111111111111", "saved");
  store.getState().destroy();
});

const secondPage = {
  url: "https://reference.invalid/review?part=2#examples",
  title: "Reference page",
  capturedAt: "2026-11-18T06:03:00Z",
  documentRevision: "doc-reference-2",
};
const comparison = {
  ...fixture.provenance,
  analysis: { ...fixture.provenance.analysis, kind: "comparison" },
  sources: [fixture.provenance.source, secondPage],
};

async function openReport({
  provenance = comparison,
  onOpenSource,
}: { provenance?: unknown; onOpenSource?: ArtifactAppOptions["onOpenSource"] } = {}) {
  setLocale("en");
  let target = { sceneId: "programming", workspaceId: "workspace" };
  const document = { ...fixture, provenance, id: "saved", handle: "artifact:saved",
    sceneId: target.sceneId, createdAt: "2026-11-18T06:02:00Z", size: 512, version: "version" };
  const gateway = { get: vi.fn(async () => ({ artifact: document })),
    list: vi.fn(), importAll: vi.fn(), delete: vi.fn() };
  const store = createArtifactStore({ gateway, getTarget: () => target, onOpenSource });
  await store.getState().openArtifact("saved");
  const view = render(<ArtifactMain store={store} />);
  return {
    ...view, store, gateway, document,
    changeWorkspace() { target = { ...target, workspaceId: "other" }; },
  };
}

it("opens the selected comparison source through the real browser route in a fresh tab", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 20, y: 50, width: 900, height: 580,
  } as DOMRect);
  const original = { id: "original", title: "Open article", url: "https://open.invalid/" };
  let revision = 0;
  const invoke = vi.fn(async (command: string, args?: { request?: { kind: string } }) => {
    if (command === "browser_get_state") return {
      startupMode: "browser", session: { activeTab: original.id, revision, tabs: [original] },
    };
    if (command === "browser_save_session") return { revision: ++revision };
    if (args?.request?.kind === "status") return { surfaceRevision: 0, tabs: [original] };
    return {};
  });
  const browser = setupBrowserApp({ invoke });
  const host = document.createElement("main");
  document.body.append(host);
  let active = false;
  try {
    const report = await openReport({
      onOpenSource: (url, scope) => navigateToBrowserSource(url, {
        scope,
        activate: () => { browser.renderContent(host); active = true; },
        isActive: () => active,
        open: (source: string, current: () => boolean) => browser.openSource(source, current),
      }),
    });
    const sources = report.container.querySelector(".artifacts-sources");
    expect(sources?.textContent).toContain("doc-synthetic-1");
    expect(sources?.textContent).toContain(secondPage.documentRevision);
    expect(sources?.querySelectorAll("time")).toHaveLength(2);
    expect(Array.from(sources?.querySelectorAll("li") ?? []).map((item) => item.value)).toEqual([1, 2]);
    fireEvent.click(screen.getByRole("button", { name: secondPage.title }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_save_session", expect.objectContaining({
      activeTab: expect.not.stringMatching(/^original$/),
      tabs: [expect.objectContaining(original), expect.objectContaining({ url: secondPage.url })],
    })));
    expect(invoke).toHaveBeenCalledWith("browser_control", expect.objectContaining({
      request: expect.objectContaining({ kind: "create", url: secondPage.url }),
    }));
    expect(report.store.getState().selected).toEqual(report.document);
    expect(report.gateway.get).toHaveBeenCalledOnce();
  } finally {
    await browser.canDeactivate();
    host.remove();
  }
});

it("keeps capture metadata readable when the Studio browser is unavailable", async () => {
  const { container } = await openReport({ provenance: fixture.provenance });
  const source = container.querySelector(".artifacts-sources");
  expect(source?.textContent).toContain(fixture.provenance.source.title);
  expect(source?.textContent).toContain(fixture.provenance.source.url);
  expect(source?.querySelector("button, a")).toBeNull();
});

it.each([
  "file:///C:/notes.txt", "javascript:alert(1)", "https://name:token@example.invalid/",
])("keeps unsupported saved source URLs inert", async (url) => {
  const onOpenSource = vi.fn();
  const provenance = { ...comparison, sources: [fixture.provenance.source, { ...secondPage, url }] };
  await openReport({ provenance, onOpenSource });
  expect(screen.queryByRole("button", { name: secondPage.title })).toBeNull();
  expect(screen.getByRole("button", { name: fixture.provenance.source.title })).toBeTruthy();
  expect(onOpenSource).not.toHaveBeenCalled();
});

it("ignores repeated clicks and invalidates route work when the workspace changes", async () => {
  let finish!: () => void;
  let current!: () => boolean;
  const onOpenSource = vi.fn<NonNullable<ArtifactAppOptions["onOpenSource"]>>((_url, scope) => {
    current = scope.isCurrent;
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const report = await openReport({ onOpenSource });
  const button = screen.getByRole("button", { name: secondPage.title }) as HTMLButtonElement;
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(onOpenSource).toHaveBeenCalledOnce();
  expect(current()).toBe(true);
  report.changeWorkspace();
  expect(current()).toBe(false);
  await act(async () => { finish(); });
  fireEvent.click(button);
  expect(onOpenSource).toHaveBeenCalledOnce();
});
