import { create } from "zustand";
// @ts-expect-error plain JS module without type declarations
import { getPackageInstallFailure } from "../../../../public/packages/install-status.js";

export const PKG_API_BASE = "https://pi-packages-api.shixin.workers.dev";
export const BROWSE_PAGE_SIZE = 50;

export interface BrowsePackage {
  name: string;
  description?: string;
  types?: string[];
  downloads?: number;
  author?: string;
  links?: { npm?: string; repository?: string; homepage?: string };
  updatedAt?: unknown;
  updated?: unknown;
  modified?: unknown;
  date?: unknown;
  time?: unknown;
}

export interface HostControlGatewayLike {
  listPiPackages(): Promise<string[]>;
  installPiPackage(source: string): Promise<unknown>;
  removePiPackage(source: string): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
}

export function browseSourceFor(pkg: BrowsePackage): string {
  return `npm:${pkg.name}`;
}

export function normalizeRepoUrl(url: unknown): string | null {
  if (!url) return null;
  return String(url)
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

export function browseUpdatedTime(pkg: BrowsePackage): number {
  const raw = pkg.updatedAt ?? pkg.updated ?? pkg.modified ?? pkg.date ?? pkg.time ?? 0;
  const t = typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

export function sortPackages(
  packages: BrowsePackage[],
  sortMode: string,
): BrowsePackage[] {
  const sorted = packages.slice();
  switch (sortMode) {
    case "name":
      sorted.sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }),
      );
      break;
    case "updated":
      sorted.sort((a, b) => browseUpdatedTime(b) - browseUpdatedTime(a));
      break;
    default:
      sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      break;
  }
  return sorted;
}

export function filterPackages(options: {
  packages: BrowsePackage[];
  installedSet: Set<string>;
  installedOnly: boolean;
  activeType: string;
  searchQuery: string;
  sortMode: string;
}): BrowsePackage[] {
  const { packages, installedSet, installedOnly, activeType, searchQuery, sortMode } = options;
  const query = searchQuery.toLowerCase().trim();
  const filtered = packages.filter((pkg) => {
    if (installedOnly && !installedSet.has(browseSourceFor(pkg))) return false;
    if (activeType !== "all") {
      if (!Array.isArray(pkg.types) || !pkg.types.includes(activeType)) return false;
    }
    if (query) {
      const inName = pkg.name.toLowerCase().includes(query);
      const inDesc = (pkg.description || "").toLowerCase().includes(query);
      const inAuthor = (pkg.author || "").toLowerCase().includes(query);
      if (!inName && !inDesc && !inAuthor) return false;
    }
    return true;
  });
  return sortPackages(filtered, sortMode);
}

interface PackageBrowseState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  canManage: boolean;
  packages: BrowsePackage[];
  installedSet: Set<string>;
  activeType: string;
  searchQuery: string;
  installedOnly: boolean;
  sortMode: string;
  page: number;
  busySource: string | null;
  load(force?: boolean): Promise<void>;
  setSearch(query: string): void;
  setType(type: string): void;
  setInstalledOnly(enabled: boolean): void;
  setSort(sortMode: string): void;
  goToPage(page: number): void;
  toggleInstall(pkg: BrowsePackage): Promise<void>;
  openLink(url: string): void;
}

async function fetchCatalog(fetchImpl: typeof fetch): Promise<BrowsePackage[]> {
  const pageSize = 250;
  // The catalog is paginated (5234+ packages at 250/page ≈ 21 pages). Fetching
  // every page sequentially keeps the browser stuck on "Loading packages…" for
  // 20–40s, so read the page count from the first response, then fetch the
  // remaining pages in parallel while preserving page order.
  const first = await fetchImpl(`${PKG_API_BASE}/packages?page=1&pageSize=${pageSize}`);
  if (!first.ok) throw new Error(`Registry returned ${first.status}`);
  const firstData = (await first.json()) as {
    packages?: BrowsePackage[];
    totalPages?: number;
  };
  const all: BrowsePackage[] = Array.isArray(firstData.packages)
    ? [...firstData.packages]
    : [];
  const totalPages = Number(firstData.totalPages) || 1;
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) =>
      fetchImpl(`${PKG_API_BASE}/packages?page=${index + 2}&pageSize=${pageSize}`).then(
        async (res) => {
          if (!res.ok) throw new Error(`Registry returned ${res.status}`);
          const data = (await res.json()) as { packages?: BrowsePackage[] };
          return Array.isArray(data.packages) ? data.packages : [];
        },
      ),
    ),
  );
  for (const batch of remaining) all.push(...batch);
  return all;
}

export function createPackageBrowseStore(options: {
  control: HostControlGatewayLike | null;
  notify?: (message: { type: string; title: string; message: string; detail?: string }) => void;
  fetchImpl?: typeof fetch;
}) {
  const control = options.control;
  const notify = options.notify ?? (() => {});
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function refreshInstalled(): Promise<Set<string>> {
    if (!control) return new Set();
    try {
      const configured = await control.listPiPackages();
      return new Set(Array.isArray(configured) ? configured : []);
    } catch {
      return new Set();
    }
  }

  return create<PackageBrowseState>()((set, get) => ({
    status: "idle",
    error: null,
    canManage: Boolean(control),
    packages: [],
    installedSet: new Set(),
    activeType: "all",
    searchQuery: "",
    installedOnly: false,
    sortMode: "downloads",
    page: 1,
    busySource: null,

    async load(force = false) {
      if (get().status === "loading") return;
      if (get().status === "ready" && !force) return;
      set({ status: "loading", error: null });
      try {
        const [packages, installedSet] = await Promise.all([
          fetchCatalog(fetchImpl),
          refreshInstalled(),
        ]);
        set({ packages, installedSet, status: "ready", error: null });
      } catch (error) {
        set({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    setSearch(searchQuery) {
      set({ searchQuery, page: 1 });
    },

    setType(activeType) {
      set({ activeType, page: 1 });
    },

    async setInstalledOnly(enabled) {
      let installedSet = get().installedSet;
      if (enabled) installedSet = await refreshInstalled();
      set({ installedOnly: enabled, installedSet, page: 1 });
    },

    setSort(sortMode) {
      set({ sortMode, page: 1 });
    },

    goToPage(page) {
      set({ page });
    },

    async toggleInstall(pkg) {
      if (!control) return;
      const source = browseSourceFor(pkg);
      const installed = get().installedSet.has(source);
      set({ busySource: source });
      try {
        if (installed) {
          await control.removePiPackage(source);
          const next = new Set(get().installedSet);
          next.delete(source);
          set({ installedSet: next });
        } else {
          await control.installPiPackage(source);
          const next = new Set(get().installedSet);
          next.add(source);
          set({ installedSet: next });
        }
      } catch (error) {
        const operation = installed ? "uninstall" : "install";
        const failure = getPackageInstallFailure(error, operation);
        notify({
          type: "error",
          title: failure.title,
          message: failure.note,
          detail: failure.detail,
        });
      } finally {
        set({ busySource: null });
      }
    },

    openLink(url) {
      if (!url) return;
      if (control) {
        control.openExternal(url).catch((error: unknown) => {
          console.error("[browse] failed to open external link:", error);
        });
      } else {
        globalThis.open(url, "_blank", "noopener");
      }
    },
  }));
}

export type PackageBrowseStore = ReturnType<typeof createPackageBrowseStore>;
