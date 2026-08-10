// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
  ModelRuntime: { create: vi.fn() },
  SessionManager: { inMemory: vi.fn() },
}));

const tempHomes: string[] = [];

async function loadConfigWithTempHome() {
  const home = mkdtempSync(join(tmpdir(), "picot-config-auth-"));
  tempHomes.push(home);
  vi.resetModules();
  vi.stubEnv("PI_CODING_AGENT_DIR", "");
  vi.stubEnv("PI_DESKTOP_INSTANCE_DIR", "");
  vi.stubEnv("PI_DESKTOP_DATA_DIR", home);
  process.env.HOME = home;
  const module = await import("./picot-config.ts");
  return {
    home,
    handlePicotConfig: module.handlePicotConfig,
  };
}

async function loadConfigWithIsolatedAgentRoot(sceneId = "programming") {
  const root = mkdtempSync(join(tmpdir(), "picot-config-isolated-"));
  tempHomes.push(root);
  vi.resetModules();
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "scene-agent"));
  vi.stubEnv("PI_DESKTOP_INSTANCE_DIR", join(root, "instance"));
  vi.stubEnv("PI_DESKTOP_SCENE_ID", sceneId);
  const module = await import("./picot-config.ts");
  return {
    root,
    handlePicotConfig: module.handlePicotConfig,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("picot config auth operations", () => {
  it("persists a readable project profile inside the active workspace", async () => {
    const { handlePicotConfig } = await loadConfigWithTempHome();
    const workspace = mkdtempSync(join(tmpdir(), "picot-project-profile-"));
    tempHomes.push(workspace);

    const written = await handlePicotConfig(
      "write_project_profile",
      {
        profile: {
          instructions: "Keep decisions traceable",
          defaultScene: "finance",
          budget: "12.5",
        },
      },
      { cwd: workspace },
    );

    expect(written).toMatchObject({
      ok: true,
      data: {
        profile: { instructions: "Keep decisions traceable", defaultScene: "finance", budget: 12.5 },
        path: join(workspace, ".zicode", "project.json"),
      },
    });
    expect(JSON.parse(readFileSync(join(workspace, ".zicode", "project.json"), "utf8"))).toMatchObject({
      version: 1,
      instructions: "Keep decisions traceable",
      budget: 12.5,
    });

    await expect(handlePicotConfig("read_project_profile", {}, { cwd: workspace })).resolves.toMatchObject({
      ok: true,
      data: { profile: { instructions: "Keep decisions traceable", budget: 12.5 } },
    });
  });

  it("uses the scene-isolated agent directory when supplied by the desktop host", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    const authPath = join(root, "scene-agent", "auth.json");

    await handlePicotConfig("set_api_key", { provider: "openai", apiKey: "sk-isolated" }, {});

    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({
      openai: { type: "api_key", key: "sk-isolated" },
    });
    expect(existsSync(join(root, ".pi", "agent", "auth.json"))).toBe(false);
  });

  it("checks QVeris model health through the live gateway credential", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    const agentDir = join(root, "scene-agent");
    const authPath = join(agentDir, "auth.json");
    const modelsPath = join(agentDir, "models.json");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      authPath,
      JSON.stringify({ qveris: { type: "api_key", key: "sk-health-test" } }),
    );
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          qveris: {
            baseUrl: "http://127.0.0.1:57620/v2/model-gateway",
            api: "openai-completions",
            authHeader: true,
            models: [{ id: "deepseek-v4-flash" }],
          },
        },
      }),
    );
    const model = { provider: "qveris", id: "deepseek-v4-flash", name: "deepseek-v4-flash" };
    const registry = {
      getAll: () => [model],
      getAvailable: () => [model],
      getProviderAuthStatus: () => ({ configured: true, source: "system" }),
      getProviderDisplayName: () => "QVeris Model Gateway",
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"choices":[{"message":{"role":"assistant","content":"OK"}}]}',
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await handlePicotConfig(
      "check_model_health",
      { provider: "qveris" },
      { modelRegistry: registry },
    );

    expect(result.ok).toBe(true);
    const results = (result as { data: { results: Array<{ status: string }> } }).data.results;
    expect(results[0]?.status).toBe("healthy");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:57620/v2/model-gateway/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-health-test" }),
        body: expect.stringContaining('"max_tokens":128'),
      }),
    );
  });

  it("hides catalog entries the gateway definitively rejects with model_not_found", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    const agentDir = join(root, "scene-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({ qveris: { type: "api_key", key: "sk-health-test" } }),
    );
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          qveris: {
            baseUrl: "http://127.0.0.1:57620/v2/model-gateway",
            api: "openai-completions",
            authHeader: true,
            models: [{ id: "deepseek-chat" }, { id: "deepseek-v4-flash" }],
          },
        },
      }),
    );
    const catalog = [
      { provider: "qveris", id: "deepseek-chat", name: "deepseek-chat" },
      { provider: "qveris", id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
    ];
    const registry = {
      getAll: () => catalog,
      getAvailable: () => catalog,
      getProviderAuthStatus: () => ({ configured: true, source: "system" }),
      getProviderDisplayName: () => "QVeris Model Gateway",
    };
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          error: { code: "model_not_found", message: "the requested model is not available" },
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await handlePicotConfig(
      "check_model_health",
      { provider: "qveris" },
      { modelRegistry: registry },
    );

    expect(result.ok).toBe(true);
    const prefsPath = join(agentDir, "picot-models.json");
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
    expect(prefs.visibility).toEqual({
      "qveris/deepseek-chat": false,
      "qveris/deepseek-v4-flash": false,
    });
  });

  it("keeps the QVeris gateway apiKey env reference in the scene models document", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    const agentDir = join(root, "scene-agent");
    mkdirSync(agentDir, { recursive: true });
    const modelsPath = join(agentDir, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          qveris: {
            baseUrl: "http://127.0.0.1:57620/v2/model-gateway",
            api: "openai-completions",
            authHeader: true,
            models: [{ id: "deepseek-v4-flash" }],
          },
        },
      }),
    );
    const model = { provider: "qveris", id: "deepseek-v4-flash", name: "deepseek-v4-flash" };
    const registry = {
      getAll: () => [model],
      getAvailable: () => [model],
      getProviderAuthStatus: () => ({ configured: false }),
      getProviderDisplayName: () => "QVeris Model Gateway",
    };

    await handlePicotConfig("list_model_catalog", {}, { modelRegistry: registry });

    const document = JSON.parse(readFileSync(modelsPath, "utf8"));
    expect(document.providers.qveris.apiKey).toBe("$QVERIS_API_KEY");
  });

  it("stores and removes API keys without requiring registry authStorage", async () => {
    vi.stubEnv("HOME", "");
    const { home, handlePicotConfig } = await loadConfigWithTempHome();
    const authPath = join(home, "agent", "auth.json");

    await expect(
      handlePicotConfig("set_api_key", { provider: "openai", apiKey: "sk-test" }, {}),
    ).resolves.toEqual({ ok: true, data: { provider: "openai" } });

    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({
      openai: { type: "api_key", key: "sk-test" },
    });

    await expect(handlePicotConfig("remove_api_key", { provider: "openai" }, {})).resolves.toEqual({
      ok: true,
      data: { provider: "openai" },
    });

    expect(existsSync(authPath)).toBe(true);
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({});
  });

  it("updates the active registry credential store before refreshing", async () => {
    const { handlePicotConfig } = await loadConfigWithTempHome();
    const credentials = {
      modify: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const registry = {
      runtime: { credentials },
      refresh: vi.fn(async () => undefined),
    };

    await expect(
      handlePicotConfig(
        "set_api_key",
        { provider: "anthropic", apiKey: "sk-ant-test" },
        { modelRegistry: registry },
      ),
    ).resolves.toEqual({ ok: true, data: { provider: "anthropic" } });

    expect(credentials.modify).toHaveBeenCalledWith("anthropic", expect.any(Function));
    await expect(credentials.modify.mock.calls[0][1](undefined)).resolves.toEqual({
      type: "api_key",
      key: "sk-ant-test",
    });
    expect(registry.refresh).toHaveBeenCalledTimes(1);

    await expect(
      handlePicotConfig("remove_api_key", { provider: "anthropic" }, { modelRegistry: registry }),
    ).resolves.toEqual({ ok: true, data: { provider: "anthropic" } });

    expect(credentials.delete).toHaveBeenCalledWith("anthropic");
    expect(registry.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("structured provider channels", () => {
  it("keeps QVeris visible before its first model sync", async () => {
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot("finance");
    const registry = {
      getAll: () => [],
      getAvailable: async () => [],
      getProviderAuthStatus: () => ({ configured: false }),
      getProviderDisplayName: (provider: string) => provider,
      refresh: vi.fn(),
    };

    await expect(
      handlePicotConfig("list_model_catalog", {}, { modelRegistry: registry }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        providers: [
          expect.objectContaining({
            provider: "qveris",
            displayName: "QVeris Model Gateway",
            configured: false,
            models: [],
          }),
        ],
      },
    });
  });

  it("hydrates the live credential store and removes the auth document when the system broker is active", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    vi.stubEnv("PI_DESKTOP_CREDENTIAL_BROKER", "system");
    const authPath = join(root, "scene-agent", "auth.json");
    const credentials = { modify: vi.fn(async () => undefined) };
    const registry = { runtime: { credentials }, refresh: vi.fn(async () => undefined) };

    await expect(
      handlePicotConfig(
        "set_api_key",
        { provider: "openai", apiKey: "sk-brokered" },
        { modelRegistry: registry },
      ),
    ).resolves.toEqual({ ok: true, data: { provider: "openai" } });

    expect(existsSync(authPath)).toBe(false);
    expect(credentials.modify).toHaveBeenCalledWith("openai", expect.any(Function));
    await expect(credentials.modify.mock.calls[0][1](undefined)).resolves.toEqual({
      type: "api_key",
      key: "sk-brokered",
    });
  });

  it("keeps the auth document when no live credential store is available", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    vi.stubEnv("PI_DESKTOP_CREDENTIAL_BROKER", "system");
    const authPath = join(root, "scene-agent", "auth.json");

    await expect(
      handlePicotConfig("set_api_key", { provider: "openai", apiKey: "sk-brokered" }, {}),
    ).resolves.toEqual({ ok: true, data: { provider: "openai" } });

    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({
      openai: { type: "api_key", key: "sk-brokered" },
    });
  });

  it("persists baseUrl, API type, models, and credentials in scene-local files", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();

    await expect(
      handlePicotConfig(
        "save_provider_channel",
        {
          provider: "team-proxy",
          baseUrl: "https://models.example.com/v1/",
          api: "openai-responses",
          apiKey: "secret-value",
          authHeader: true,
          models: [
            {
              id: "reasoning-model",
              name: "Reasoning Model",
              reasoning: true,
              contextWindow: 200000,
              maxTokens: 32000,
            },
          ],
        },
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      data: { provider: "team-proxy", refreshed: false },
    });

    const agentRoot = join(root, "scene-agent");
    const models = JSON.parse(readFileSync(join(agentRoot, "models.json"), "utf8"));
    expect(models.providers["team-proxy"]).toMatchObject({
      baseUrl: "https://models.example.com/v1",
      api: "openai-responses",
      authHeader: true,
      models: [{ id: "reasoning-model", reasoning: true }],
    });
    expect(JSON.parse(readFileSync(join(agentRoot, "auth.json"), "utf8"))).toEqual({
      "team-proxy": { type: "api_key", key: "secret-value" },
    });

    const listed = await handlePicotConfig("list_provider_channels", {}, {});
    expect(listed).toMatchObject({
      ok: true,
      data: {
        channels: expect.arrayContaining([
          expect.objectContaining({
            provider: "qveris",
            baseUrl: "https://aigateway.qveris.ai/v1",
            builtIn: true,
          }),
          expect.objectContaining({
            provider: "team-proxy",
            baseUrl: "https://models.example.com/v1",
          }),
        ]),
      },
    });
    expect(JSON.stringify(listed)).not.toContain("secret-value");
  });

  it("rejects unsafe provider identifiers and URLs with embedded credentials", async () => {
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();

    await expect(
      handlePicotConfig(
        "save_provider_channel",
        {
          provider: "../escape",
          baseUrl: "https://user:pass@example.com/v1",
          models: [{ id: "model" }],
        },
        {},
      ),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("finance workbench operations", () => {
  it("reports scene-local QVeris readiness without exposing the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "qveris-chat",
                context_window: 128000,
                capabilities: ["chat", "tools"],
                pricing: {
                  prompt_usd_per_million_tokens: 1,
                  completion_usd_per_million_tokens: 2,
                  cached_input_usd_per_million_tokens: 0.5,
                  tiers: null,
                },
              },
            ],
          }),
      })),
    );
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot("finance");
    await expect(
      handlePicotConfig(
        "set_api_key",
        { provider: "qveris", apiKey: "qv-finance-secret" },
        {},
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { modelSync: { count: 1 } },
    });

    const status = await handlePicotConfig("finance_status", {}, {});
    expect(status).toMatchObject({
      ok: true,
      data: {
        sceneId: "finance",
        qveris: { configured: true },
        tools: expect.arrayContaining(["qveris_discover", "finance_backtest"]),
      },
    });
    expect(JSON.stringify(status)).not.toContain("qv-finance-secret");
  });

  it("allows the built-in QVeris gateway endpoint to be edited without renaming it", async () => {
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();

    await expect(
      handlePicotConfig(
        "save_provider_channel",
        {
          originalProvider: "qveris",
          provider: "qveris",
          baseUrl: "http://gateway.internal:8080/v1/",
          api: "openai-completions",
          models: [],
        },
        {},
      ),
    ).resolves.toMatchObject({ ok: true, data: { provider: "qveris" } });

    const listed = await handlePicotConfig("list_provider_channels", {}, {});
    expect(listed).toMatchObject({
      ok: true,
      data: {
        channels: expect.arrayContaining([
          expect.objectContaining({
            provider: "qveris",
            baseUrl: "http://gateway.internal:8080/v1",
            builtIn: true,
          }),
        ]),
      },
    });
  });

  it("runs deterministic backtests only inside the Finance scene", async () => {
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot("finance");
    const result = await handlePicotConfig(
      "finance_backtest",
      {
        input: {
          bars: [
            { date: "2026-01-01", open: 10, close: 10 },
            { date: "2026-01-02", open: 11, close: 11 },
            { date: "2026-01-03", open: 12, close: 12 },
          ],
          strategy: { type: "buy_and_hold" },
          feeBps: 0,
          slippageBps: 0,
        },
      },
      {},
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        assumptions: { signalTiming: expect.stringContaining("next-bar") },
        metrics: { totalReturn: expect.any(Number) },
      },
    });
  });

  it("runs explainable screening and persists isolated paper accounts", async () => {
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot("finance");
    const screening = await handlePicotConfig(
      "finance_screen",
      {
        input: {
          securities: [
            { symbol: "A", metrics: { roe: 0.2, pe: 10 } },
            { symbol: "B", metrics: { roe: 0.1, pe: 20 } },
          ],
          factors: [
            { field: "roe", direction: "high", weight: 1 },
            { field: "pe", direction: "low", weight: 1 },
          ],
        },
      },
      {},
    );
    expect(screening).toMatchObject({
      ok: true,
      data: {
        results: expect.arrayContaining([
          expect.objectContaining({ symbol: "A", rank: 1 }),
        ]),
      },
    });

    const created = await handlePicotConfig(
      "finance_paper_accounts",
      { action: "create", name: "模拟账户", baseCurrency: "CNY", initialCash: 10_000 },
      {},
    );
    expect(created).toMatchObject({ ok: true, data: { name: "模拟账户", cash: 10_000 } });
    const accountId = created.ok ? (created.data as { id: string }).id : "";
    const order = await handlePicotConfig(
      "finance_paper_order",
      {
        input: {
          accountId,
          symbol: "600000.SH",
          side: "buy",
          quantity: 100,
          snapshot: {
            price: 10,
            asOf: "2026-07-30T07:00:00Z",
            source: "QVeris test snapshot",
          },
          feeBps: 0,
        },
      },
      {},
    );
    expect(order).toMatchObject({
      ok: true,
      data: { account: { cash: 9_000, positions: [{ symbol: "600000.SH", quantity: 100 }] } },
    });

    const snapshot = await handlePicotConfig(
      "finance_market_data",
      {
        action: "save",
        snapshot: {
          kind: "quote",
          symbol: "600000.SH",
          market: "CN",
          currency: "CNY",
          asOf: "2026-07-30T07:30:00Z",
          source: { provider: "QVeris", executionId: "exec_test" },
          payload: { price: 11 },
        },
      },
      {},
    );
    expect(snapshot).toMatchObject({
      ok: true,
      data: { symbol: "600000.SH", source: { executionId: "exec_test" } },
    });

    const marked = await handlePicotConfig(
      "finance_paper_accounts",
      {
        action: "mark",
        accountId,
        quotes: [
          {
            symbol: "600000.SH",
            price: 11,
            asOf: "2026-07-30T07:30:00Z",
            source: "QVeris exec_test",
            currency: "CNY",
          },
        ],
      },
      {},
    );
    expect(marked).toMatchObject({
      ok: true,
      data: { equity: 10_100, marketValue: 1_100, unrealizedPnl: 100, complete: true },
    });

    const limitOrder = await handlePicotConfig(
      "finance_paper_limit_order",
      {
        action: "place",
        accountId,
        symbol: "600000.SH",
        side: "sell",
        quantity: 20,
        limitPrice: 12,
        feeBps: 0,
        currency: "CNY",
      },
      {},
    );
    expect(limitOrder).toMatchObject({
      ok: true,
      data: { order: { type: "limit", status: "pending" } },
    });
    const processed = await handlePicotConfig(
      "finance_paper_limit_order",
      {
        action: "process",
        accountId,
        quotes: [
          {
            symbol: "600000.SH",
            price: 12,
            asOf: "2026-07-30T08:00:00Z",
            source: "QVeris exec_limit",
            currency: "CNY",
          },
        ],
      },
      {},
    );
    expect(processed).toMatchObject({
      ok: true,
      data: {
        processed: [{ status: "filled" }],
        account: { cash: 9_240, positions: [{ symbol: "600000.SH", quantity: 80 }] },
      },
    });
  });

  it("persists watchlist research with opposing evidence and invalidation", async () => {
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot("finance");
    const created = await handlePicotConfig(
      "finance_research_workspace",
      {
        action: "upsert",
        card: {
          symbol: "aapl",
          title: "Earnings watch",
          thesis: "Services growth supports margins.",
          bullCase: "Recurring revenue is expanding.",
          bearCase: "Hardware demand may weaken.",
          invalidation: "Services growth falls below 5%.",
          sources: ["QVeris exec_123", "https://example.test/filing"],
          eventAt: "2026-10-29T20:00:00.000Z",
        },
      },
      {},
    );
    expect(created).toMatchObject({
      ok: true,
      data: {
        card: {
          symbol: "AAPL",
          bearCase: "Hardware demand may weaken.",
          invalidation: "Services growth falls below 5%.",
        },
      },
    });
    await expect(
      handlePicotConfig("finance_research_workspace", { action: "list" }, {}),
    ).resolves.toMatchObject({ ok: true, data: { cards: [{ symbol: "AAPL" }] } });
  });
});

describe("automation workspace operations", () => {
  it("persists schedules, approval policy, cost limits, retries, and run history", async () => {
    const { handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    const created = await handlePicotConfig(
      "automation_workspace",
      {
        action: "upsert",
        workflow: {
          title: "Daily summary",
          prompt: "Summarize the project",
          schedule: "interval",
          intervalMinutes: 30,
          requireApproval: true,
          maxCost: 1.5,
          maxRetries: 3,
          enabled: true,
        },
      },
      {},
    );
    expect(created).toMatchObject({
      ok: true,
      data: {
        workflow: {
          title: "Daily summary",
          intervalMinutes: 30,
          requireApproval: true,
          maxCost: 1.5,
          maxRetries: 3,
        },
      },
    });
    const workflowId = created.ok
      ? (created.data as { workflow: { id: string } }).workflow.id
      : "";
    await expect(
      handlePicotConfig(
        "automation_workspace",
        {
          action: "record_run",
          id: workflowId,
          approvalPending: true,
          run: { status: "approval_required", message: "Waiting" },
        },
        {},
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { workflow: { approvalPending: true, history: [{ status: "approval_required" }] } },
    });
  });
});
