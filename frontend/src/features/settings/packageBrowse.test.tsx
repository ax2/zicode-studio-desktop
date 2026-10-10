import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PackageBrowseTab } from "./PackageBrowseTab";
import {
  type BrowsePackage,
  browseSourceFor,
  createPackageBrowseStore,
  filterPackages,
  type HostControlGatewayLike,
  normalizeRepoUrl,
} from "./packageBrowseStore";

afterEach(() => {
  document.body.innerHTML = "";
});

const PACKAGES: BrowsePackage[] = [
  { name: "zebra-tool", types: ["extension"], downloads: 50, description: "Zebra tooling" },
  { name: "alpha-skill", types: ["skill"], downloads: 200, description: "Alpha skill" },
  { name: "mid-theme", types: ["theme"], downloads: 100, description: "Mid theme" },
];

function controlStub(): HostControlGatewayLike {
  return {
    listPiPackages: vi.fn(async () => []),
    installPiPackage: vi.fn(async () => ({})),
    removePiPackage: vi.fn(async () => ({})),
    openExternal: vi.fn(async () => ({})),
  };
}

function fetchStub(packages: BrowsePackage[] = PACKAGES): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ packages, totalPages: 1 }),
  })) as unknown as typeof fetch;
}

describe("package browse logic", () => {
  it("builds npm sources and normalizes repository URLs", () => {
    expect(browseSourceFor({ name: "foo" })).toBe("npm:foo");
    expect(normalizeRepoUrl("git@github.com:user/repo.git")).toBe(
      "https://github.com/user/repo",
    );
    expect(normalizeRepoUrl(null)).toBeNull();
  });

  it("filters by type, search, and installed state then sorts", () => {
    const filtered = filterPackages({
      packages: PACKAGES,
      installedSet: new Set(["npm:alpha-skill"]),
      installedOnly: false,
      activeType: "extension",
      searchQuery: "",
      sortMode: "downloads",
    });
    expect(filtered.map((pkg) => pkg.name)).toEqual(["zebra-tool"]);

    const byName = filterPackages({
      packages: PACKAGES,
      installedSet: new Set(),
      installedOnly: false,
      activeType: "all",
      searchQuery: "",
      sortMode: "name",
    });
    expect(byName[0].name).toBe("alpha-skill");

    const installedOnly = filterPackages({
      packages: PACKAGES,
      installedSet: new Set(["npm:alpha-skill"]),
      installedOnly: true,
      activeType: "all",
      searchQuery: "",
      sortMode: "downloads",
    });
    expect(installedOnly.map((pkg) => pkg.name)).toEqual(["alpha-skill"]);
  });
});

describe("package browse store + React tab", () => {
  it("loads the catalog and renders package rows", async () => {
    const control = controlStub();
    const store = createPackageBrowseStore({
      control,
      fetchImpl: fetchStub(),
    });
    render(<PackageBrowseTab store={store} />);
    await store.getState().load();
    await waitFor(() => expect(screen.getByText("zebra-tool")).toBeTruthy());
    expect(control.listPiPackages).toHaveBeenCalled();
    expect(document.querySelectorAll(".pkg-browse-row").length).toBe(3);
    expect(document.querySelector(".pkg-browse-count")?.textContent).toContain("of 3");
  });

  it("loads a multi-page catalog in parallel and preserves page order", async () => {
    const pages: Record<number, BrowsePackage[]> = {
      1: [PACKAGES[0]],
      2: [PACKAGES[1]],
      3: [PACKAGES[2]],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const page = Number(/page=(\d+)/.exec(String(input))?.[1] ?? 1);
      return {
        ok: true,
        json: async () => ({ packages: pages[page] ?? [], totalPages: 3 }),
      };
    });
    const store = createPackageBrowseStore({
      control: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await store.getState().load();

    expect(store.getState().packages.map((pkg) => pkg.name)).toEqual([
      "zebra-tool",
      "alpha-skill",
      "mid-theme",
    ]);
    const requestedPages = fetchImpl.mock.calls.map((call) =>
      Number(/page=(\d+)/.exec(String(call[0]))?.[1]),
    );
    expect(requestedPages).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("filters by type pill and search input", async () => {
    const store = createPackageBrowseStore({ control: null, fetchImpl: fetchStub() });
    render(<PackageBrowseTab store={store} />);
    await store.getState().load();
    await waitFor(() => expect(screen.getByText("zebra-tool")).toBeTruthy());
    store.getState().setType("skill");
    await waitFor(() => expect(screen.queryByText("zebra-tool")).toBeNull());
    expect(screen.getByText("alpha-skill")).toBeTruthy();
    store.getState().setType("all");
    store.getState().setSearch("mid");
    await waitFor(() => expect(screen.queryByText("zebra-tool")).toBeNull());
    expect(screen.getByText("mid-theme")).toBeTruthy();
  });

  it("installs and uninstalls through the control gateway", async () => {
    const install = vi.fn(async () => ({}));
    const remove = vi.fn(async () => ({}));
    const control = {
      ...controlStub(),
      installPiPackage: install,
      removePiPackage: remove,
    };
    const store = createPackageBrowseStore({ control, fetchImpl: fetchStub() });
    await store.getState().load();
    await store.getState().toggleInstall(PACKAGES[0]);
    expect(install).toHaveBeenCalledWith("npm:zebra-tool");
    expect(store.getState().installedSet.has("npm:zebra-tool")).toBe(true);
    await store.getState().toggleInstall(PACKAGES[0]);
    expect(remove).toHaveBeenCalledWith("npm:zebra-tool");
    expect(store.getState().installedSet.has("npm:zebra-tool")).toBe(false);
  });

  it("shows a load error with retry", async () => {
    const store = createPackageBrowseStore({
      control: null,
      fetchImpl: vi.fn(async () => {
        throw new Error("registry down");
      }) as unknown as typeof fetch,
    });
    render(<PackageBrowseTab store={store} />);
    await store.getState().load();
    await waitFor(() => expect(document.querySelector("#pkg-browse-retry")).toBeTruthy());
    expect(document.querySelector("#pkg-browse-list")?.textContent).toContain("registry down");
  });
});
