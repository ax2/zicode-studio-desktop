import { flushSync } from "react-dom";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { createElement } from "react";
import { t } from "../../shared/i18n";
import {
  FinanceContentApp,
  FinanceNavApp,
  type FinanceWorkbenchController,
} from "./FinanceWorkbenchApp";
import { shortTimestamp, type FinanceResponse } from "./financeWorkbenchLogic";
import {
  createFinanceWorkbenchStore,
  type FinanceWorkbenchStoreHook,
} from "./financeWorkbenchStore";

export interface FinanceWorkbenchOptions {
  configGateway?: {
    call(
      method: string,
      params?: Record<string, unknown>,
      options?: { timeoutMs?: number },
    ): Promise<FinanceResponse>;
  };
  getTarget?(): { sceneId?: string; workspaceId?: string } | null;
  openConfiguration?(): void;
  openSceneSettings?(): void;
  createFinanceSession?(): Promise<unknown>;
  openFinanceApp?(): void;
  artifactGateway?: {
    create(
      sceneId: string,
      workspaceId: string,
      artifact: Record<string, unknown>,
    ): Promise<unknown>;
  } | null;
  notify?(notification: Record<string, unknown>): void;
  confirmRemove?(message: string): boolean | Promise<boolean>;
}

export interface FinanceWorkbenchHandle {
  loadStatus(): Promise<void>;
  openPanel(viewId?: string): Promise<void>;
  setTarget(): void;
  selectView(viewId: string): void;
  renderNavigation(container: HTMLElement | null): void;
  renderContent(container: HTMLElement | null): void;
  destroy(): void;
}

export function setupFinanceWorkbench({
  configGateway,
  getTarget = () => null,
  openConfiguration = () => {},
  openSceneSettings = () => {},
  createFinanceSession = async () => {},
  openFinanceApp = () => {},
  artifactGateway = null,
  notify = () => {},
  confirmRemove = (message: string) => globalThis.confirm?.(message) ?? false,
}: FinanceWorkbenchOptions): FinanceWorkbenchHandle | null {
  if (!configGateway) return null;
  const store = createFinanceWorkbenchStore();
  let navigationContainer: HTMLElement | null = null;
  let contentContainer: HTMLElement | null = null;
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;

  const commit = (
    patch: Partial<ReturnType<FinanceWorkbenchStoreHook["getState"]>>,
  ) => {
    store.setState(patch);
    flushSync(() => {});
  };

  const call = (
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<FinanceResponse> =>
    configGateway
      .call(method, params, options)
      .catch((error: unknown): FinanceResponse => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));

  const setBusy = (key: string, busy: boolean) => {
    commit({ busy: { ...store.getState().busy, [key]: busy } });
  };

  const setResult = (key: keyof ReturnType<FinanceWorkbenchStoreHook["getState"]>, value: unknown) => {
    commit({ [key]: value } as Partial<ReturnType<FinanceWorkbenchStoreHook["getState"]>>);
  };

  const parseJsonInput = (
    text: string,
    resultKey: string,
    errorKey: string,
  ): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setResult(resultKey as keyof ReturnType<FinanceWorkbenchStoreHook["getState"]>, {
          ok: false,
          error: t(errorKey),
        });
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      setResult(resultKey as keyof ReturnType<FinanceWorkbenchStoreHook["getState"]>, {
        ok: false,
        error: t(errorKey),
      });
      return null;
    }
  };

  async function recordArtifact(artifact: Record<string, unknown>) {
    if (!artifactGateway) return;
    try {
      await artifactGateway.create(
        getTarget?.()?.sceneId ?? "finance",
        getTarget?.()?.workspaceId ?? "",
        {
          pluginId: "com.zicode.finance",
          mimeType: "application/json",
          ...artifact,
        },
      );
      notify({ message: t("Added to Artifacts"), type: "success" });
    } catch {
      notify({ message: t("Result was shown but could not be added to Artifacts"), type: "warning" });
    }
  }

  async function loadStatus() {
    commit({ status: { state: "checking" } });
    const result = await call("finance_status");
    if (!result?.ok) {
      commit({ status: { state: "unavailable", error: result?.error } });
      return;
    }
    const qveris = result.data?.qveris as Record<string, unknown> | undefined;
    const configured = qveris?.configured === true;
    commit({ status: { state: configured ? "connected" : "missing" } });
  }

  async function loadPaperAccounts() {
    setResult("paperAccounts", { ok: false, error: t("Loading paper accounts…") });
    const result = await call("finance_paper_accounts", { action: "list" });
    setResult("paperAccounts", result);
  }

  async function loadResearchWorkspace() {
    setResult("research", { ok: false, error: t("Loading research workspace…") });
    const result = await call("finance_research_workspace", { action: "list" });
    setResult("research", result);
  }

  async function removeResearchCard(id: string) {
    if (!(await confirmRemove(t("Remove this research card? This cannot be undone.")))) {
      return;
    }
    const removed = await call("finance_research_workspace", { action: "remove", id });
    if (!removed?.ok) {
      notify({
        title: t("Could not remove research card"),
        message: removed?.error,
        type: "error",
      });
      return;
    }
    await loadResearchWorkspace();
  }

  const controller: FinanceWorkbenchController = {
    selectView(viewId) {
      if (FINANCE_VIEW_IDS.has(viewId)) {
        commit({ activeViewId: viewId });
      }
      renderNavigation(navigationContainer);
      renderContent(contentContainer);
      if (store.getState().activeViewId === "overview") void loadStatus();
      if (store.getState().activeViewId === "paper") void loadPaperAccounts();
      if (store.getState().activeViewId === "research") void loadResearchWorkspace();
    },
    openConfiguration: () => openConfiguration?.(),
    openSceneSettings: () => openSceneSettings?.(),
    createFinanceSession: () => createFinanceSession(),
    async runUsage() {
      setBusy("usage", true);
      setResult("usage", { ok: false, error: t("Loading usage audit…") });
      const result = await call("finance_qveris_usage", { limit: 10 }, { timeoutMs: 60_000 });
      setBusy("usage", false);
      setResult("usage", result);
    },
    async runDiscovery(query) {
      setBusy("discovery", true);
      setResult("discovery", { ok: false, error: t("Discovering capabilities…") });
      const result = await call(
        "finance_discover",
        { query: String(query ?? "").trim(), limit: 8 },
        { timeoutMs: 60_000 },
      );
      setBusy("discovery", false);
      setResult("discovery", result);
    },
    async saveSnapshot(input) {
      const snapshot = parseJsonInput(input, "snapshotSaved", "Snapshot input must be valid JSON.");
      if (!snapshot) return;
      setBusy("snapshot", true);
      const result = await call("finance_market_data", { action: "save", snapshot });
      setBusy("snapshot", false);
      setResult(
        "snapshotSaved",
        result?.ok ? t("Snapshot saved.") : result?.error || t("Could not save snapshot."),
      );
      if (result?.ok) {
        await recordArtifact({
          kind: "dataset",
          title: [t("Market data snapshot"), snapshot.symbol || snapshot.kind]
            .filter(Boolean)
            .join(" · "),
          summary: t("Saved market data with its as-of time and execution provenance."),
          provenance: {
            engine: "finance.market-data",
            source: snapshot.source ?? {},
            asOf: snapshot.asOf ?? null,
          },
          content: { snapshot, result: result.data ?? null },
        });
      }
    },
    async listSnapshots() {
      setBusy("snapshot", true);
      const result = await call("finance_market_data", { action: "list", limit: 10 });
      setBusy("snapshot", false);
      setResult("snapshots", result);
    },
    async runBacktest(input) {
      const parsed = parseJsonInput(input, "backtest", "Backtest input must be valid JSON.");
      if (!parsed) return;
      setBusy("backtest", true);
      setResult("backtest", { ok: false, error: t("Running backtest…") });
      const result = await call("finance_backtest", { input: parsed }, { timeoutMs: 60_000 });
      setBusy("backtest", false);
      setResult("backtest", result);
      if (result?.ok) {
        await recordArtifact({
          kind: "report",
          title: `${t("Strategy backtest")} · ${shortTimestamp()}`,
          summary: t("Deterministic local backtest result with its complete input."),
          provenance: { engine: "finance.backtest.local", deterministic: true },
          content: { input: parsed, result: result.data ?? null },
        });
      }
    },
    async runScreening(input) {
      const parsed = parseJsonInput(input, "screening", "Screening input must be valid JSON.");
      if (!parsed) return;
      setBusy("screening", true);
      setResult("screening", { ok: false, error: t("Ranking candidates…") });
      const result = await call("finance_screen", { input: parsed }, { timeoutMs: 60_000 });
      setBusy("screening", false);
      setResult("screening", result);
      if (result?.ok) {
        await recordArtifact({
          kind: "report",
          title: `${t("Multi-factor screener")} · ${shortTimestamp()}`,
          summary: t("Explainable local ranking with its complete factor input."),
          provenance: { engine: "finance.screen.local", deterministic: true },
          content: { input: parsed, result: result.data ?? null },
        });
      }
    },
    refreshResearch: () => void loadResearchWorkspace(),
    async saveResearchCard(card) {
      setBusy("research", true);
      const result = await call("finance_research_workspace", { action: "upsert", card });
      setBusy("research", false);
      if (!result?.ok) {
        setResult(
          "research",
          result?.error ? { ok: false, error: result.error } : { ok: false, error: t("Could not save research card") },
        );
        return;
      }
      notify({ title: t("Research card saved"), type: "success" });
      await loadResearchWorkspace();
    },
    removeResearchCard,
    refreshPaperAccounts: () => void loadPaperAccounts(),
    async createPaperAccount(account) {
      setBusy("paperAccount", true);
      const result = await call("finance_paper_accounts", {
        action: "create",
        name: account.name,
        baseCurrency: account.baseCurrency,
        initialCash: account.initialCash,
      });
      setBusy("paperAccount", false);
      if (!result?.ok) {
        setResult("paperAccounts", {
          ok: false,
          error: result?.error || t("Could not create paper account."),
        });
        return;
      }
      await loadPaperAccounts();
    },
    async removePaperAccount(accountId) {
      if (!(await confirmRemove(t("Remove this paper account? This cannot be undone.")))) {
        return;
      }
      setBusy("paperAccount", true);
      const result = await call("finance_paper_accounts", { action: "remove", accountId });
      setBusy("paperAccount", false);
      if (!result?.ok) {
        setResult("paperAccounts", {
          ok: false,
          error: result?.error || t("Could not remove paper account."),
        });
        return;
      }
      await loadPaperAccounts();
    },
    async recordPaperOrder(input) {
      const parsed = parseJsonInput(input, "paperOrder", "Paper order input must be valid JSON.");
      if (!parsed) return;
      setBusy("paperOrder", true);
      setResult("paperOrder", t("Recording simulated order…"));
      const result = await call("finance_paper_order", { input: parsed });
      setBusy("paperOrder", false);
      if (!result?.ok) {
        setResult(
          "paperOrder",
          result?.error || t("Could not record simulated order."),
        );
        return;
      }
      setResult("paperOrder", t("Simulated order recorded."));
      await loadPaperAccounts();
    },
    async manageLimitOrder(input) {
      const parsed = parseJsonInput(input, "paperLimit", "Limit order input must be valid JSON.");
      if (!parsed) return;
      setBusy("paperLimit", true);
      const result = await call("finance_paper_limit_order", parsed);
      setBusy("paperLimit", false);
      setResult("paperLimit", result);
      if (result?.ok) await loadPaperAccounts();
    },
    async markPortfolio(input) {
      const parsed = parseJsonInput(input, "paperMark", "Portfolio quotes must be valid JSON.");
      if (!parsed) return;
      setBusy("paperMark", true);
      const result = await call("finance_paper_accounts", { action: "mark", ...parsed });
      setBusy("paperMark", false);
      setResult("paperMark", result);
    },
  };

  function renderNavigation(container: HTMLElement | null) {
    if (!container) return;
    navigationContainer = container;
    navRoot = mountPluginSurface(
      container,
      createElement(FinanceNavApp, { store, controller }),
      navRoot,
    );
  }

  function renderContent(container: HTMLElement | null) {
    if (!container) return;
    contentContainer = container;
    container.classList.add("finance-plugin-main");
    contentRoot = mountPluginSurface(
      container,
      createElement(FinanceContentApp, { store, controller }),
      contentRoot,
    );
  }

  function setTarget() {
    const sceneId = getTarget?.()?.sceneId ?? null;
    commit({ sceneId });
    renderNavigation(navigationContainer);
    renderContent(contentContainer);
  }

  async function openPanel(viewId = "overview") {
    controller.selectView(viewId);
    openFinanceApp?.();
    await loadStatus();
    await loadPaperAccounts();
    await loadResearchWorkspace();
  }

  const handleLocaleChange = () => {
    renderNavigation(navigationContainer);
    renderContent(contentContainer);
  };
  window.addEventListener("zicode:locale-changed", handleLocaleChange);
  commit({ sceneId: getTarget?.()?.sceneId ?? null });

  return {
    loadStatus,
    openPanel,
    setTarget,
    selectView: controller.selectView,
    renderNavigation,
    renderContent,
    destroy() {
      window.removeEventListener("zicode:locale-changed", handleLocaleChange);
      navRoot?.unmount();
      contentRoot?.unmount();
    },
  };
}

const FINANCE_VIEW_IDS = new Set([
  "overview",
  "discovery",
  "snapshots",
  "backtest",
  "screening",
  "research",
  "paper",
]);
