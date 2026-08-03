import { afterEach, describe, expect, it, vi } from "vitest";
import { setupFinanceWorkbench } from "./finance-workbench.js";

function render() {
  document.body.innerHTML = `
    <aside id="finance-workbench" class="hidden">
      <button id="finance-workbench-close"></button>
      <span id="finance-qveris-status"></span>
      <button id="finance-open-configuration"></button>
      <button id="finance-qveris-usage"></button>
      <div id="finance-qveris-usage-results"></div>
      <form id="finance-discovery-form">
        <input id="finance-discovery-query" />
        <button type="submit"></button>
      </form>
      <div id="finance-discovery-results"></div>
      <form id="finance-snapshot-form">
        <textarea id="finance-snapshot-input"></textarea>
        <button type="submit"></button>
      </form>
      <button id="finance-snapshot-sample" type="button"></button>
      <button id="finance-snapshot-list" type="button"></button>
      <div id="finance-snapshot-results"></div>
      <form id="finance-backtest-form">
        <textarea id="finance-backtest-input"></textarea>
        <button type="submit"></button>
      </form>
      <button id="finance-backtest-sample" type="button"></button>
      <div id="finance-backtest-results"></div>
      <form id="finance-screen-form">
        <textarea id="finance-screen-input"></textarea>
        <button type="submit"></button>
      </form>
      <button id="finance-screen-sample" type="button"></button>
      <div id="finance-screen-results"></div>
      <button id="finance-paper-refresh"></button>
      <form id="finance-paper-account-form">
        <input id="finance-paper-account-name" />
        <input id="finance-paper-account-currency" />
        <input id="finance-paper-account-cash" />
        <button type="submit"></button>
      </form>
      <div id="finance-paper-accounts"></div>
      <form id="finance-paper-order-form">
        <textarea id="finance-paper-order-input"></textarea>
        <button type="submit"></button>
      </form>
      <div id="finance-paper-order-results"></div>
    </aside>
  `;
}

function renderPluginLayout() {
  document.body.innerHTML = `
    <aside id="finance-workbench" class="hidden">
      <div class="finance-workbench-body">
        <section class="ui-card">
          <div class="finance-section-heading"><div><h3></h3><p></p></div></div>
          <span id="finance-qveris-status"></span>
          <button id="finance-qveris-usage"></button>
          <button id="finance-open-configuration"></button>
          <div id="finance-qveris-usage-results"></div>
        </section>
        <section class="ui-card">
          <div class="finance-section-heading"><div><h3></h3><p></p></div></div>
          <form id="finance-discovery-form"><input id="finance-discovery-query"><button type="submit"></button></form>
          <div id="finance-discovery-results"></div>
        </section>
        <section class="ui-card">
          <div class="finance-section-heading"><div><h3></h3><p></p></div></div>
        </section>
        <section class="ui-card">
          <div class="finance-section-heading"><div><h3></h3><p></p></div></div>
          <form id="finance-backtest-form"><textarea id="finance-backtest-input"></textarea><button type="submit"></button></form>
          <button id="finance-backtest-sample"></button>
          <div id="finance-backtest-results"></div>
        </section>
        <section class="ui-card">
          <div class="finance-section-heading"><div><h3></h3><p></p></div></div>
          <form id="finance-screen-form"><textarea id="finance-screen-input"></textarea><button type="submit"></button></form>
          <button id="finance-screen-sample"></button>
          <div id="finance-screen-results"></div>
        </section>
        <section class="ui-card">
          <div class="finance-section-heading"><div><h3></h3><p></p></div></div>
          <button id="finance-paper-refresh"></button>
          <div id="finance-paper-accounts"></div>
        </section>
      </div>
    </aside>
    <aside id="plugin-navigation"></aside>
    <main id="plugin-content"></main>
  `;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("finance workbench", () => {
  it("renders Finance navigation and one exclusive main view with a scene guard", () => {
    renderPluginLayout();
    let target = { sceneId: "finance" };
    const workbench = setupFinanceWorkbench({
      configGateway: { call: vi.fn(async () => ({ ok: true, data: {} })) },
      getTarget: () => target,
    });
    const navigation = document.getElementById("plugin-navigation");
    const content = document.getElementById("plugin-content");

    workbench.renderNavigation(navigation);
    workbench.renderContent(content);
    expect(navigation.textContent).toContain("数据能力发现");
    expect(content.textContent).toContain("QVeris 金融数据");
    expect(content.querySelectorAll(".finance-plugin-section")).toHaveLength(1);

    workbench.selectView("backtest");
    expect(content.textContent).toContain("策略回测");
    expect(content.textContent).not.toContain("多因子选股器");

    target = { sceneId: "programming" };
    workbench.setTarget();
    expect(content.textContent).toContain("金融工作台需要金融场景");
    expect(navigation.querySelector("button").disabled).toBe(true);
  });

  it("opens without a header button and closes outside the active Finance runtime", async () => {
    render();
    const call = vi.fn(async (op) => {
      if (op === "finance_status") {
        return { ok: true, data: { qveris: { configured: true } } };
      }
      if (op === "finance_paper_accounts") return { ok: true, data: { accounts: [] } };
      throw new Error(`unexpected ${op}`);
    });
    const workbench = setupFinanceWorkbench({
      configGateway: { call },
      getTarget: () => ({ sceneId: "finance" }),
    });

    await workbench.openPanel();
    expect(document.getElementById("finance-qveris-status").textContent).toBe("已连接");

    workbench.setTarget({ sceneId: "programming" });
    expect(document.getElementById("finance-workbench").classList.contains("hidden")).toBe(true);
  });

  it("renders discovered capabilities and deterministic backtest metrics", async () => {
    render();
    const call = vi.fn(async (op) => {
      if (op === "finance_status") return { ok: true, data: { qveris: { configured: true } } };
      if (op === "finance_discover") {
        return {
          ok: true,
          data: {
            results: [
              {
                tool_id: "market.history.v1",
                name: "Historical prices",
                provider_name: "Market Data",
                expected_cost: "3 credits",
              },
            ],
          },
        };
      }
      if (op === "finance_backtest") {
        return {
          ok: true,
          data: {
            metrics: {
              totalReturn: 0.12,
              cagr: 0.1,
              maxDrawdown: -0.08,
              sharpeRatio: 1.2,
              finalEquity: 112000,
              completedTrades: 3,
            },
          },
        };
      }
      if (op === "finance_paper_accounts") return { ok: true, data: { accounts: [] } };
      throw new Error(`unexpected ${op}`);
    });
    const artifactGateway = { create: vi.fn(async () => ({ artifact: {} })) };
    setupFinanceWorkbench({
      configGateway: { call },
      getTarget: () => ({ sceneId: "finance" }),
      artifactGateway,
    });

    document.getElementById("finance-discovery-query").value = "historical prices";
    document
      .getElementById("finance-discovery-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("finance-discovery-results").textContent).toContain(
        "Historical prices",
      ),
    );

    document.getElementById("finance-backtest-input").value = "{}";
    document
      .getElementById("finance-backtest-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("finance-backtest-results").textContent).toContain("12.00%"),
    );
    await vi.waitFor(() => expect(artifactGateway.create).toHaveBeenCalledOnce());
    expect(artifactGateway.create).toHaveBeenCalledWith(
      "finance",
      expect.objectContaining({
        pluginId: "com.zicode.finance",
        kind: "report",
        provenance: { engine: "finance.backtest.local", deterministic: true },
        content: expect.objectContaining({
          input: {},
          result: expect.objectContaining({ metrics: expect.any(Object) }),
        }),
      }),
    );
  });

  it("renders factor coverage and paper-account balances without HTML injection", async () => {
    render();
    const call = vi.fn(async (op) => {
      if (op === "finance_screen") {
        return {
          ok: true,
          data: {
            results: [
              { rank: 1, symbol: "<img src=x onerror=alert(1)>", score: 1.25, coverage: 0.75 },
            ],
          },
        };
      }
      if (op === "finance_paper_accounts") {
        return {
          ok: true,
          data: {
            accounts: [
              {
                id: "paper-1",
                name: "A股模拟盘",
                baseCurrency: "CNY",
                cash: 998000,
                positionCount: 1,
              },
            ],
          },
        };
      }
      if (op === "finance_qveris_usage") {
        return {
          ok: true,
          data: {
            usage: {
              data: {
                items: [{ charge_outcome: "charged" }],
                total: 4,
                summary: { total_count: 4, settled_credits: 12 },
              },
            },
            ledger: {
              data: {
                items: [{ balance_after: { total_available_credits: 988 } }],
              },
            },
          },
        };
      }
      throw new Error(`unexpected ${op}`);
    });
    const artifactGateway = { create: vi.fn(async () => ({ artifact: {} })) };
    setupFinanceWorkbench({
      configGateway: { call },
      getTarget: () => ({ sceneId: "finance" }),
      artifactGateway,
    });

    document.getElementById("finance-screen-input").value = "{}";
    document
      .getElementById("finance-screen-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("finance-screen-results").textContent).toContain("75.00%"),
    );
    expect(document.querySelector("#finance-screen-results img")).toBeNull();
    await vi.waitFor(() => expect(artifactGateway.create).toHaveBeenCalledOnce());
    expect(artifactGateway.create.mock.calls[0][1]).toMatchObject({
      kind: "report",
      provenance: { engine: "finance.screen.local", deterministic: true },
    });

    document.getElementById("finance-paper-refresh").click();
    await vi.waitFor(() =>
      expect(document.getElementById("finance-paper-accounts").textContent).toContain("998,000"),
    );

    document.getElementById("finance-qveris-usage").click();
    await vi.waitFor(() =>
      expect(document.getElementById("finance-qveris-usage-results").textContent).toContain("988"),
    );
  });

  it("archives saved snapshots and keeps successful results visible if archival fails", async () => {
    render();
    const call = vi.fn(async (op) => {
      if (op === "finance_market_data") return { ok: true, data: { snapshotId: "snapshot-1" } };
      if (op === "finance_backtest") {
        return {
          ok: true,
          data: {
            metrics: {
              totalReturn: 0.05,
              cagr: 0.04,
              maxDrawdown: -0.02,
              sharpeRatio: 0.8,
              finalEquity: 105000,
              completedTrades: 1,
            },
          },
        };
      }
      throw new Error(`unexpected ${op}`);
    });
    const artifactGateway = {
      create: vi
        .fn()
        .mockResolvedValueOnce({ artifact: {} })
        .mockRejectedValueOnce(new Error("artifact unavailable")),
    };
    const notify = vi.fn();
    setupFinanceWorkbench({
      configGateway: { call },
      getTarget: () => ({ sceneId: "finance" }),
      artifactGateway,
      notify,
    });

    document.getElementById("finance-snapshot-input").value = JSON.stringify({
      kind: "quote",
      symbol: "600519.SH",
      asOf: "2026-07-31T08:00:00Z",
      source: { provider: "QVeris", executionId: "run-1" },
      payload: { price: 1400 },
    });
    document
      .getElementById("finance-snapshot-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(artifactGateway.create).toHaveBeenCalledOnce());
    expect(artifactGateway.create.mock.calls[0][1]).toMatchObject({
      kind: "dataset",
      provenance: {
        engine: "finance.market-data",
        asOf: "2026-07-31T08:00:00Z",
      },
    });

    document.getElementById("finance-backtest-input").value = "{}";
    document
      .getElementById("finance-backtest-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("finance-backtest-results").textContent).toContain("5.00%"),
    );
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("结果已显示，但无法添加到产物库"));
  });
});
