import { afterEach, describe, expect, it, vi } from "vitest";
import { setupFinanceWorkbench } from "./index";

function mountWorkbench(
  target: { sceneId: string } = { sceneId: "finance" },
  overrides: Record<string, unknown> = {},
) {
  const navigation = document.createElement("aside");
  navigation.id = "plugin-navigation";
  const content = document.createElement("main");
  content.id = "plugin-content";
  document.body.append(navigation, content);
  const call =
    (overrides.call as ReturnType<typeof vi.fn>) ??
    vi.fn(async () => ({ ok: true, data: {} }));
  const workbench = setupFinanceWorkbench({
    configGateway: { call },
    getTarget: () => target,
    ...overrides,
  });
  if (!workbench) throw new Error("workbench mount failed");
  workbench.renderNavigation(navigation);
  workbench.renderContent(content);
  return { navigation, content, workbench, call };
}

function submitForm(container: HTMLElement, viewId: string) {
  const form = container.querySelector(
    `[data-finance-view="${viewId}"] form`,
  ) as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return form;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("finance workbench", () => {
  it("renders Finance navigation and one exclusive main view with a scene guard", () => {
    const targetRef = { current: { sceneId: "finance" } };
    const { navigation, content, workbench } = mountWorkbench(undefined, {
      getTarget: () => targetRef.current,
    });

    expect(navigation.textContent).toContain("数据能力发现");
    expect(content.textContent).toContain("QVeris 金融数据");
    expect(content.querySelectorAll(".finance-plugin-section")).toHaveLength(1);

    workbench.selectView("backtest");
    expect(content.textContent).toContain("策略回测");
    expect(content.textContent).not.toContain("多因子选股器");

    targetRef.current = { sceneId: "programming" };
    workbench.setTarget();
    expect(content.textContent).toContain("金融工作台需要金融场景");
    expect(
      navigation.querySelector<HTMLButtonElement>(".finance-nav-item")?.disabled,
    ).toBe(true);
  });

  it("loads the status and shows Connected when the Finance key is configured", async () => {
    const call = vi.fn(async (op: string) => {
      if (op === "finance_status") {
        return { ok: true, data: { qveris: { configured: true } } };
      }
      if (op === "finance_paper_accounts" || op === "finance_research_workspace") {
        return { ok: true, data: {} };
      }
      throw new Error(`unexpected ${op}`);
    });
    const { content, workbench } = mountWorkbench({ sceneId: "finance" }, { call });

    await workbench.openPanel();
    await vi.waitFor(() => expect(content.textContent).toContain("已连接"));
  });

  it("renders discovered capabilities and deterministic backtest metrics", async () => {
    const call = vi.fn(async (op: string) => {
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
      if (op === "finance_paper_accounts" || op === "finance_research_workspace") {
        return { ok: true, data: {} };
      }
      throw new Error(`unexpected ${op}`);
    });
    const artifactGateway = {
      create: vi.fn(
        async (
          _sceneId: string,
          _workspaceId: string,
          _artifact: Record<string, unknown>,
        ) => ({
          artifact: {},
        }),
      ),
    };
    const { content, workbench } = mountWorkbench(
      { sceneId: "finance" },
      { call, artifactGateway },
    );

    workbench.selectView("discovery");
    (
      content.querySelector(
        '[data-finance-view="discovery"] input',
      ) as HTMLInputElement
    ).value = "historical prices";
    submitForm(content, "discovery");
    await vi.waitFor(() =>
      expect(content.textContent).toContain("Historical prices"),
    );

    workbench.selectView("backtest");
    (
      content.querySelector(
        '[data-finance-view="backtest"] textarea',
      ) as HTMLTextAreaElement
    ).value = "{}";
    submitForm(content, "backtest");
    await vi.waitFor(() => expect(content.textContent).toContain("12.00%"));
    await vi.waitFor(() => expect(artifactGateway.create).toHaveBeenCalledOnce());
    expect(artifactGateway.create).toHaveBeenCalledWith(
      "finance",
      "",
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
    const call = vi.fn(async (op: string) => {
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
      if (op === "finance_status" || op === "finance_research_workspace") {
        return { ok: true, data: {} };
      }
      throw new Error(`unexpected ${op}`);
    });
    const artifactGateway = {
      create: vi.fn(
        async (
          _sceneId: string,
          _workspaceId: string,
          _artifact: Record<string, unknown>,
        ) => ({
          artifact: {},
        }),
      ),
    };
    const { content, workbench } = mountWorkbench(
      { sceneId: "finance" },
      { call, artifactGateway },
    );

    workbench.selectView("screening");
    (
      content.querySelector(
        '[data-finance-view="screening"] textarea',
      ) as HTMLTextAreaElement
    ).value = "{}";
    submitForm(content, "screening");
    await vi.waitFor(() => expect(content.textContent).toContain("75.00%"));
    expect(content.querySelector('img')).toBeNull();
    await vi.waitFor(() => expect(artifactGateway.create).toHaveBeenCalledOnce());
    expect(artifactGateway.create.mock.calls[0][2]).toMatchObject({
      kind: "report",
      provenance: { engine: "finance.screen.local", deterministic: true },
    });

    workbench.selectView("paper");
    content
      .querySelector('[data-finance-view="paper"] button')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(content.textContent).toContain("998,000"));

    workbench.selectView("overview");
    content
      .querySelectorAll('[data-finance-view="overview"] button')[0]
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(content.textContent).toContain("988"));
  });

  it("archives saved snapshots and keeps successful results visible if archival fails", async () => {
    const call = vi.fn(async (op: string) => {
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
      if (op === "finance_paper_accounts" || op === "finance_research_workspace") {
        return { ok: true, data: {} };
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
    const { content, workbench } = mountWorkbench(
      { sceneId: "finance" },
      { call, artifactGateway, notify },
    );

    workbench.selectView("snapshots");
    (
      content.querySelector(
        '[data-finance-view="snapshots"] textarea',
      ) as HTMLTextAreaElement
    ).value = JSON.stringify({
      kind: "quote",
      symbol: "600519.SH",
      asOf: "2026-07-31T08:00:00Z",
      source: { provider: "QVeris", executionId: "run-1" },
      payload: { price: 1400 },
    });
    submitForm(content, "snapshots");
    await vi.waitFor(() => expect(artifactGateway.create).toHaveBeenCalledOnce());
    expect(artifactGateway.create.mock.calls[0][2]).toMatchObject({
      kind: "dataset",
      provenance: {
        engine: "finance.market-data",
        asOf: "2026-07-31T08:00:00Z",
      },
    });

    workbench.selectView("backtest");
    (
      content.querySelector(
        '[data-finance-view="backtest"] textarea',
      ) as HTMLTextAreaElement
    ).value = "{}";
    submitForm(content, "backtest");
    await vi.waitFor(() => expect(content.textContent).toContain("5.00%"));
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "结果已显示，但无法添加到产物库",
        }),
      ),
    );
  });
});
