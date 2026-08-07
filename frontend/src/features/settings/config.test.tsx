import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfigTab } from "./ConfigTab";
import { createConfigStore, type ConfigGatewayLike, type ConfigGatewayResult } from "./configStore";
import { createSettingsWidgetsStore } from "./settingsWidgetsStore";

function makeGateway(overrides: Record<string, unknown> = {}): {
  gateway: ConfigGatewayLike;
  calls: Array<{ op: string; params?: unknown }>;
} {
  const calls: Array<{ op: string; params?: unknown }> = [];
  const gateway: ConfigGatewayLike = {
    async call(op, params) {
      calls.push({ op, params });
      const handler = overrides[op];
      if (typeof handler === "function") {
        return (handler as (p: unknown) => Promise<ConfigGatewayResult>)(params);
      }
      return { ok: true, data: {} };
    },
  };
  return { gateway, calls };
}

describe("settings config store", () => {
  it("loads the model catalog into providers", async () => {
    const { gateway, calls } = makeGateway({
      list_model_catalog: async () => ({
        ok: true,
        data: { providers: [{ provider: "openai", displayName: "OpenAI", configured: true }] },
      }),
    });
    const store = createConfigStore({ configGateway: gateway });
    await store.getState().loadApiKeys();
    expect(store.getState().apiStatus).toBe("ready");
    expect(store.getState().providers[0].provider).toBe("openai");
    expect(calls.some((call) => call.op === "list_model_catalog")).toBe(true);
  });

  it("reports catalog load errors with a retry state", async () => {
    const { gateway } = makeGateway({
      list_model_catalog: async () => ({ ok: false, error: "catalog down" }),
    });
    const store = createConfigStore({ configGateway: gateway });
    await store.getState().loadApiKeys();
    expect(store.getState().apiStatus).toBe("error");
    expect(store.getState().apiError).toBe("catalog down");
  });

  it("stores an API key through the gateway and refreshes dependent panels", async () => {
    const { gateway, calls } = makeGateway({
      set_api_key: async () => ({ ok: true }),
      list_model_catalog: async () => ({
        ok: true,
        data: { providers: [{ provider: "openai", configured: true }] },
      }),
      list_provider_channels: async () => ({ ok: true, data: { channels: [] } }),
      read_models_config: async () => ({ ok: true, data: { content: "{}", path: "/m.json" } }),
    });
    const onModelConfigurationChanged = vi.fn();
    const store = createConfigStore({
      configGateway: gateway,
      onModelConfigurationChanged,
      invoke: vi.fn(async () => ({ configured: true, prefix: "sk-" })),
    });
    await store.getState().loadApiKeys();
    await store.getState().openApiKeyEditor(store.getState().providers[0]);
    store.getState().setApiKeyInput("sk-test");
    await store.getState().saveApiKey();
    expect(calls.some((call) => call.op === "set_api_key")).toBe(true);
    expect(store.getState().editingProvider).toBeNull();
    expect(onModelConfigurationChanged).toHaveBeenCalled();
  });

  it("rejects an empty API key without calling the gateway", async () => {
    const { gateway, calls } = makeGateway({});
    const store = createConfigStore({ configGateway: gateway });
    await store.getState().openApiKeyEditor({ provider: "openai" });
    await store.getState().saveApiKey();
    expect(store.getState().apiKeyError).toBeTruthy();
    expect(calls.some((call) => call.op === "set_api_key")).toBe(false);
  });

  it("loads provider channels and opens the editor with existing values", async () => {
    const { gateway } = makeGateway({
      list_provider_channels: async () => ({
        ok: true,
        data: {
          channels: [
            { provider: "team-proxy", baseUrl: "https://proxy/v1", api: "openai-completions", models: [{ id: "gpt-5.2" }] },
          ],
        },
      }),
    });
    const store = createConfigStore({ configGateway: gateway });
    await store.getState().loadChannels();
    expect(store.getState().channels).toHaveLength(1);
    await store.getState().openChannelEditor(store.getState().channels[0]);
    const form = store.getState().channelEditor;
    expect(form?.provider).toBe("team-proxy");
    expect(form?.modelsText).toBe("gpt-5.2");
  });

  it("validates that a new channel has at least one model", async () => {
    const { gateway, calls } = makeGateway({});
    const store = createConfigStore({ configGateway: gateway });
    await store.getState().openChannelEditor(null);
    await store.getState().saveChannel();
    expect(store.getState().channelEditorError).toBe("Add at least one model ID.");
    expect(calls.some((call) => call.op === "save_provider_channel")).toBe(false);
  });

  it("saves a provider channel and refreshes the scene configuration", async () => {
    const { gateway, calls } = makeGateway({
      save_provider_channel: async () => ({ ok: true }),
      list_provider_channels: async () => ({ ok: true, data: { channels: [] } }),
      list_model_catalog: async () => ({ ok: true, data: { providers: [] } }),
      read_models_config: async () => ({ ok: true, data: { content: "{}", path: "/m.json" } }),
    });
    const onModelConfigurationChanged = vi.fn();
    const store = createConfigStore({ configGateway: gateway, onModelConfigurationChanged });
    await store.getState().openChannelEditor(null);
    store.getState().setChannelForm({
      provider: "team-proxy",
      baseUrl: "https://proxy/v1",
      api: "openai-completions",
      modelsText: "gpt-5.2",
    });
    await store.getState().saveChannel();
    expect(calls.some((call) => call.op === "save_provider_channel")).toBe(true);
    expect(store.getState().channelEditor).toBeNull();
    expect(onModelConfigurationChanged).toHaveBeenCalled();
  });

  it("loads and saves the inline agent config editor", async () => {
    const { gateway, calls } = makeGateway({
      read_agent_config: async () => ({ ok: true, data: { content: '{"model":"gpt"}', path: "/a.json" } }),
      write_agent_config: async () => ({ ok: true }),
    });
    const store = createConfigStore({ configGateway: gateway });
    await store.getState().loadConfigEditor();
    expect(store.getState().configEditor.content).toContain('"model"');
    await store.getState().saveConfigEditor();
    expect(calls.some((call) => call.op === "write_agent_config")).toBe(true);
    expect(store.getState().configEditor.message?.tone).toBe("ok");
  });

  it("validates the models editor JSON before saving", async () => {
    const { gateway, calls } = makeGateway({});
    const store = createConfigStore({ configGateway: gateway });
    store.setState({ modelsEditor: { content: "not json", path: "", loading: false, message: null, saving: false } });
    await store.getState().saveModelsEditor();
    expect(store.getState().modelsEditor.message?.message).toContain("Invalid JSON");
    expect(calls.some((call) => call.op === "write_models_config")).toBe(false);
  });

  it("inserts the models example after confirmation", async () => {
    const { gateway } = makeGateway({});
    const store = createConfigStore({ configGateway: gateway, confirmImpl: () => true });
    store.getState().insertModelsExample();
    expect(store.getState().modelsEditor.content).toContain("ollama");
  });

  it("updates the scene context on setTarget", () => {
    const { gateway } = makeGateway({});
    const store = createConfigStore({ configGateway: gateway, getTarget: () => ({ sceneId: "programming" }) });
    store.getState().setTarget({ sceneId: "finance" });
    expect(store.getState().sceneId).toBe("finance");
    expect(store.getState().sceneName).toBe("Finance");
  });
});

describe("settings config React tab", () => {
  it("renders providers, channels, and inline editors from the store", async () => {
    const { gateway } = makeGateway({
      list_model_catalog: async () => ({
        ok: true,
        data: {
          providers: [
            {
              provider: "openai",
              displayName: "OpenAI",
              configured: true,
              models: [{ id: "gpt-5.2", available: true, visible: true }],
            },
          ],
        },
      }),
      list_provider_channels: async () => ({
        ok: true,
        data: { channels: [{ provider: "team-proxy", baseUrl: "https://proxy/v1", api: "openai-completions" }] },
      }),
      read_agent_config: async () => ({ ok: true, data: { content: "{}", path: "/a.json" } }),
      read_models_config: async () => ({ ok: true, data: { content: "{}", path: "/m.json" } }),
    });
    const store = createConfigStore({ configGateway: gateway });
    await store.getState().loadApiKeys();
    await store.getState().loadChannels();
    await store.getState().loadConfigEditor();
    await store.getState().loadModelsEditor();
    render(<ConfigTab store={store} widgets={createSettingsWidgetsStore()} />);
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("team-proxy")).toBeTruthy();
    expect(document.getElementById("inline-config-textarea")).toBeTruthy();
    expect(document.getElementById("inline-models-textarea")).toBeTruthy();
    expect(document.querySelector(".api-model-row")?.getAttribute("data-model-id")).toBe("gpt-5.2");
  });
});
