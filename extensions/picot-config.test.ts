// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

async function loadConfigWithIsolatedAgentRoot() {
  const root = mkdtempSync(join(tmpdir(), "picot-config-isolated-"));
  tempHomes.push(root);
  vi.resetModules();
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "scene-agent"));
  vi.stubEnv("PI_DESKTOP_INSTANCE_DIR", join(root, "instance"));
  const module = await import("./picot-config.ts");
  return {
    root,
    handlePicotConfig: module.handlePicotConfig,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("picot config auth operations", () => {
  it("uses the scene-isolated agent directory when supplied by the desktop host", async () => {
    const { root, handlePicotConfig } = await loadConfigWithIsolatedAgentRoot();
    const authPath = join(root, "scene-agent", "auth.json");

    await handlePicotConfig("set_api_key", { provider: "openai", apiKey: "sk-isolated" }, {});

    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({
      openai: { type: "api_key", key: "sk-isolated" },
    });
    expect(existsSync(join(root, ".pi", "agent", "auth.json"))).toBe(false);
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
            baseUrl: "https://aigateway.qveris.ai",
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
