import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { setupArtifactApp } from "./artifact-app.js";

const DESCRIPTOR = {
  id: "artifact-1",
  handle: "artifact:artifact-1",
  sceneId: "finance",
  pluginId: "com.zicode.finance",
  kind: "report",
  title: "Deterministic backtest",
  summary: "Local engine result",
  createdAt: "2026-07-31T08:00:00Z",
  mimeType: "application/json",
  size: 128,
  version: "sha256:version",
  provenance: { engine: "finance.backtest.local", seed: 7 },
};

function createGateway() {
  return {
    list: vi.fn(async () => ({
      snapshot: {
        artifacts: [DESCRIPTOR],
        kinds: ["report"],
        plugins: ["com.zicode.finance"],
      },
    })),
    get: vi.fn(async () => ({
      artifact: {
        ...DESCRIPTOR,
        content: { metrics: { totalReturn: 0.12 } },
      },
    })),
    create: vi.fn(),
    delete: vi.fn(async () => ({ deleted: true })),
  };
}

function render(gateway, options = {}) {
  document.body.innerHTML = '<aside id="navigation"></aside><main id="content"></main>';
  const app = setupArtifactApp({
    gateway,
    getTarget: () => ({ sceneId: "finance" }),
    ...options,
  });
  app.renderNavigation(document.getElementById("navigation"));
  app.renderContent(document.getElementById("content"));
  return app;
}

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-CN");
});

describe("Artifacts application", () => {
  it("lists scene artifacts and renders content with provenance in the main view", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);

    await vi.waitFor(() => expect(document.querySelector(".artifacts-list-item")).toBeTruthy());
    document.querySelector(".artifacts-list-item").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".artifacts-document h1")?.textContent).toBe(
        "Deterministic backtest",
      ),
    );

    expect(gateway.get).toHaveBeenCalledWith("finance", "artifact-1");
    expect(document.querySelector(".artifacts-content").textContent).toContain("totalReturn");
    expect(document.querySelector(".artifacts-provenance").textContent).toContain(
      "finance.backtest.local",
    );
    expect(document.querySelector(".artifacts-metadata").textContent).toContain(
      "artifact:artifact-1",
    );
  });

  it("exports a readable document and deletes with its optimistic version", async () => {
    setLocale("en");
    const gateway = createGateway();
    const downloadFile = vi.fn();
    const notify = vi.fn();
    render(gateway, {
      downloadFile,
      notify,
      confirmDelete: () => true,
    });
    await vi.waitFor(() => expect(document.querySelector(".artifacts-list-item")).toBeTruthy());
    document.querySelector(".artifacts-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".artifacts-document")).toBeTruthy());

    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Export")
      .click();
    expect(downloadFile).toHaveBeenCalledOnce();
    expect(downloadFile.mock.calls[0][0]).toBe("Deterministic backtest.zicode-artifact.json");
    expect(downloadFile.mock.calls[0][1]).toContain('"schemaVersion": 1');

    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Delete")
      .click();
    await vi.waitFor(() => expect(gateway.delete).toHaveBeenCalledOnce());
    expect(gateway.delete).toHaveBeenCalledWith(
      "finance",
      expect.objectContaining({ id: "artifact-1", version: "sha256:version" }),
    );
  });

  it("scopes search and type filters to the active scene", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".artifacts-list-item")).toBeTruthy());

    const search = document.querySelector(".artifacts-search");
    const searchField = document.querySelector(".artifacts-search-field");
    expect(searchField.textContent).toContain("Search artifacts");
    expect(search.labels).toHaveLength(1);
    expect(search.labels[0]).toBe(searchField);
    search.value = "backtest";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(2));
    expect(gateway.list.mock.calls[1]).toEqual([
      "finance",
      { query: "backtest", kind: "", pluginId: "" },
    ]);

    [...document.querySelectorAll(".artifacts-filter")]
      .find((control) => control.textContent === "Reports")
      .click();
    await vi.waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(3));
    expect(gateway.list.mock.calls[2][1].kind).toBe("report");
  });
});
