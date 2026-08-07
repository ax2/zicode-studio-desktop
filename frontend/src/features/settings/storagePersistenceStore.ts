import { create } from "zustand";
import { t } from "../../shared/i18n";

const GLOBAL_STORE_KEY = "__zicode_storage_persistence_store__";

interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number } | null>;
}

export interface StoragePersistenceEnvironment {
  navigatorRef?: { storage?: StorageManagerLike } | null;
  documentRef?: Document | null;
  windowRef?: Window | null;
}

export interface StoragePersistenceState
  extends StoragePersistenceEnvironment {
  hidden: boolean;
  state: string;
  requesting: boolean;
  supported: boolean;
  estimate: { usage?: number; quota?: number } | null;
  buttonKey: string;
  buttonDisabled: boolean;
  statusText: string;
  configure(
    env: StoragePersistenceEnvironment & { clientType?: string },
  ): void;
  compute(): void;
  refresh(): Promise<boolean>;
  requestProtection(): Promise<boolean>;
}

type GlobalWithStore = typeof globalThis & {
  [GLOBAL_STORE_KEY]?: ReturnType<typeof createStoragePersistenceStore>;
};

function formatMegabytes(bytes: number | undefined): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "";
  const megabytes = value / (1024 * 1024);
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function primaryKeyFor(state: string): string {
  switch (state) {
    case "protected":
      return "The browser will not automatically evict ZiCode drafts. Clearing site data still removes them.";
    case "denied":
      return "The browser did not grant protection. Drafts remain encrypted but may be cleared under storage pressure.";
    case "unsupported":
      return "Persistent storage is unavailable in this browser. Drafts may be cleared under storage pressure.";
    case "error":
      return "ZiCode could not read the browser storage status. Your current draft remains available.";
    default:
      return "Drafts are encrypted on this phone but may be cleared when the browser needs space.";
  }
}

function buttonKeyFor(state: string, requesting: boolean): string {
  if (requesting) return "Requesting…";
  if (state === "protected") return "Protected";
  if (state === "unsupported") return "Unavailable";
  return "Protect drafts";
}

function createStoragePersistenceStore() {
  return create<StoragePersistenceState>()((set, get) => ({
    hidden: true,
    state: "checking",
    requesting: false,
    supported: false,
    estimate: null,
    buttonKey: "Protect drafts",
    buttonDisabled: false,
    statusText: "",
    navigatorRef: undefined,
    documentRef: undefined,
    windowRef: undefined,
    configure({ clientType, navigatorRef, documentRef, windowRef }) {
      set({ navigatorRef, documentRef, windowRef });
      if (clientType !== "remote") {
        set({
          hidden: true,
          state: "checking",
          supported: false,
          estimate: null,
        });
        return;
      }
      const storage = navigatorRef?.storage;
      const supported =
        typeof storage?.persisted === "function" &&
        typeof storage?.persist === "function";
      set({ hidden: false, supported, estimate: null });
      get().compute();
    },
    compute() {
      const state = get();
      const estimate = state.estimate;
      let usageText = "";
      if (estimate) {
        const usage = formatMegabytes(estimate.usage);
        const quota = formatMegabytes(estimate.quota);
        if (usage && quota) {
          usageText = t("Storage used: {usage} of {quota}.")
            .replace("{usage}", usage)
            .replace("{quota}", quota);
        }
      }
      const primary = t(primaryKeyFor(state.state));
      set({
        buttonKey: buttonKeyFor(state.state, state.requesting),
        buttonDisabled:
          state.requesting ||
          state.state === "protected" ||
          state.state === "unsupported",
        statusText: usageText ? `${primary} ${usageText}` : primary,
      });
    },
    async refresh() {
      const state = get();
      const storage = state.navigatorRef?.storage;
      if (!state.supported || !storage) {
        set({ state: "unsupported" });
        get().compute();
        return false;
      }
      try {
        const [persisted, nextEstimate] = await Promise.all([
          storage.persisted?.(),
          typeof storage.estimate === "function"
            ? storage.estimate().catch(() => null)
            : null,
        ]);
        set({
          estimate: nextEstimate,
          state: persisted ? "protected" : "available",
        });
        get().compute();
        return Boolean(persisted);
      } catch {
        set({ state: "error" });
        get().compute();
        return false;
      }
    },
    async requestProtection() {
      const state = get();
      const storage = state.navigatorRef?.storage;
      if (state.requesting || !state.supported || !storage) return false;
      set({ requesting: true });
      get().compute();
      try {
        const granted = await storage.persist?.();
        set({ state: granted ? "protected" : "denied" });
        if (typeof storage.estimate === "function") {
          const estimate = await storage.estimate().catch(() => null);
          set({ estimate });
        }
        return Boolean(granted);
      } catch {
        set({ state: "error" });
        return false;
      } finally {
        set({ requesting: false });
        get().compute();
      }
    },
  }));
}

export function getStoragePersistenceStore() {
  const globalStore = globalThis as GlobalWithStore;
  if (!globalStore[GLOBAL_STORE_KEY]) {
    globalStore[GLOBAL_STORE_KEY] = createStoragePersistenceStore();
  }
  return globalStore[GLOBAL_STORE_KEY] as ReturnType<
    typeof createStoragePersistenceStore
  >;
}

export function useStoragePersistenceState(): StoragePersistenceState {
  return getStoragePersistenceStore()();
}
