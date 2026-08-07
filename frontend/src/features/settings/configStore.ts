import { create } from "zustand";
import { t } from "../../shared/i18n";
// @ts-expect-error plain JS module without type declarations
import { fallbackSceneProfiles } from "../../../../public/native/settings/scene-profiles.js";

export interface ConfigModel {
  id: string;
  name?: string;
  provider?: string;
  available?: boolean;
  visible?: boolean;
  health?: { status?: string; latencyMs?: number; error?: string };
}

export interface ConfigProvider {
  provider: string;
  displayName?: string;
  configured?: boolean;
  source?: string;
  models?: ConfigModel[];
}

export interface ProviderChannel {
  provider?: string;
  builtIn?: boolean;
  baseUrl?: string;
  api?: string;
  models?: Array<{ id: string }>;
  configured?: boolean;
}

export interface ConfigGatewayResult {
  ok?: boolean;
  error?: string;
  data?: {
    providers?: ConfigProvider[];
    channels?: ProviderChannel[];
    results?: Array<{
      provider?: string;
      modelId?: string;
      status?: string;
      latencyMs?: number;
      error?: string;
    }>;
    content?: string;
    path?: string;
  };
}

export interface ConfigGatewayLike {
  call(op: string, params?: unknown, options?: { timeoutMs?: number }): Promise<ConfigGatewayResult>;
}

export interface ConfigStoreOptions {
  configGateway: ConfigGatewayLike;
  getTarget?: () => { sceneId?: string } | null;
  onModelConfigurationChanged?: () => void | Promise<void>;
  invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
  confirmImpl?: (message: string) => boolean;
}

interface EditorMessage {
  message: string;
  tone: "ok" | "error";
}

export interface ChannelEditorForm {
  originalProvider: string;
  provider: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  modelsText: string;
  keyPrefix: string | null;
}

interface ConfigState {
  sceneId: string;
  sceneName: string;
  providers: ConfigProvider[];
  apiStatus: "idle" | "loading" | "ready" | "error";
  apiError: string | null;
  apiSearch: string;
  revealAll: boolean;
  expandedProviders: Record<string, boolean>;
  editingProvider: ConfigProvider | null;
  apiKeyInput: string;
  apiKeyError: string | null;
  apiKeySaving: boolean;
  keyPrefix: string | null;
  checkingModels: string[];
  visibilitySaving: boolean;
  channels: ProviderChannel[];
  channelStatus: "idle" | "loading" | "ready" | "error";
  channelError: string | null;
  channelEditor: ChannelEditorForm | null;
  channelSaving: boolean;
  channelEditorError: string | null;
  configEditor: { content: string; path: string; loading: boolean; message: EditorMessage | null; saving: boolean };
  modelsEditor: { content: string; path: string; loading: boolean; message: EditorMessage | null; saving: boolean };
  setTarget(target: { sceneId?: string } | null): void;
  loadAll(): Promise<void>;
  loadApiKeys(options?: { preserveUi?: boolean }): Promise<void>;
  setApiSearch(query: string): void;
  setRevealAll(revealAll: boolean): void;
  toggleProviderExpanded(provider: string): void;
  openApiKeyEditor(provider: ConfigProvider): Promise<void>;
  closeApiKeyEditor(): void;
  setApiKeyInput(value: string): void;
  saveApiKey(): Promise<void>;
  removeApiKey(provider: ConfigProvider): Promise<void>;
  checkModelHealth(provider: string): Promise<void>;
  setModelVisibility(provider: string, modelId: string, visible: boolean): Promise<void>;
  setAllModelsVisibility(provider: string, visible: boolean): Promise<void>;
  loadChannels(): Promise<void>;
  openChannelEditor(channel: ProviderChannel | null): Promise<void>;
  closeChannelEditor(): void;
  setChannelForm(patch: Partial<ChannelEditorForm>): void;
  saveChannel(): Promise<void>;
  removeChannel(channel: ProviderChannel): Promise<void>;
  loadConfigEditor(): Promise<void>;
  saveConfigEditor(): Promise<void>;
  loadModelsEditor(): Promise<void>;
  saveModelsEditor(): Promise<void>;
  insertModelsExample(): void;
  openModelsDocs(): void;
}

const HEALTH_CHECK_TIMEOUT_MS = 120_000;
const MODELS_DOCS_URL =
  "https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/models.md";
const MODELS_JSON_EXAMPLE = `{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
`;

export function createConfigStore(options: ConfigStoreOptions) {
  const call = options.configGateway.call.bind(options.configGateway);
  const invoke = options.invoke;
  const confirmImpl = options.confirmImpl ?? ((message: string) => globalThis.confirm(message));

  function activeSceneId(): string {
    const sceneId = options.getTarget?.()?.sceneId;
    return typeof sceneId === "string" && sceneId.trim() ? sceneId.trim() : "programming";
  }

  async function storeSystemCredential(provider: string, secret: string): Promise<void> {
    if (!invoke) return;
    await invoke("store_scene_credential", { sceneId: activeSceneId(), provider, secret });
  }

  async function deleteSystemCredential(provider: string): Promise<void> {
    if (!invoke) return;
    await invoke("delete_scene_credential", { sceneId: activeSceneId(), provider });
  }

  async function sceneCredentialPrefix(provider: string): Promise<string | null> {
    if (!invoke) return null;
    try {
      const status = (await invoke("scene_credential_status", {
        sceneId: activeSceneId(),
        provider,
      })) as { configured?: boolean; prefix?: string } | null;
      if (!status?.configured || !status.prefix) return null;
      return `${status.prefix}•••`;
    } catch {
      return null;
    }
  }

  function sceneNameFor(sceneId: string): string {
    return fallbackSceneProfiles.find((entry: { id: string }) => entry.id === sceneId)?.name || sceneId;
  }

  let qverisAutoSyncAttempted = false;
  let renderedSceneId = "";

  async function refreshEverything() {
    await Promise.all([
      get().loadApiKeys({ preserveUi: true }),
      get().loadChannels(),
      get().loadModelsEditor(),
    ]);
    void options.onModelConfigurationChanged?.();
  }

  const get = () => store.getState();
  const store = create<ConfigState>()((set, getState) => ({
    sceneId: activeSceneId(),
    sceneName: sceneNameFor(activeSceneId()),
    providers: [],
    apiStatus: "idle",
    apiError: null,
    apiSearch: "",
    revealAll: false,
    expandedProviders: {},
    editingProvider: null,
    apiKeyInput: "",
    apiKeyError: null,
    apiKeySaving: false,
    keyPrefix: null,
    checkingModels: [],
    visibilitySaving: false,
    channels: [],
    channelStatus: "idle",
    channelError: null,
    channelEditor: null,
    channelSaving: false,
    channelEditorError: null,
    configEditor: { content: "", path: "", loading: false, message: null, saving: false },
    modelsEditor: { content: "", path: "", loading: false, message: null, saving: false },

    setTarget(target) {
      const sceneId =
        typeof target?.sceneId === "string" && target.sceneId.trim()
          ? target.sceneId.trim()
          : "programming";
      if (renderedSceneId && renderedSceneId !== sceneId) qverisAutoSyncAttempted = false;
      renderedSceneId = sceneId;
      set({ sceneId, sceneName: sceneNameFor(sceneId) });
    },

    async loadAll() {
      await Promise.all([
        getState().loadApiKeys(),
        getState().loadChannels(),
        getState().loadConfigEditor(),
        getState().loadModelsEditor(),
      ]);
    },

    async loadApiKeys({ preserveUi = false } = {}) {
      set({ apiStatus: preserveUi ? getState().apiStatus : "loading" });
      const data = await call("list_model_catalog").catch((error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }) as ConfigGatewayResult);
      if (!data?.ok || !Array.isArray(data.data?.providers)) {
        set({
          apiStatus: "error",
          apiError: data?.error || "Failed to load providers.",
          providers: [],
        });
        return;
      }
      set({ apiStatus: "ready", apiError: null, providers: data.data?.providers ?? [] });
    },

    setApiSearch(apiSearch) {
      set({ apiSearch });
    },

    setRevealAll(revealAll) {
      set({ revealAll });
    },

    toggleProviderExpanded(provider) {
      const current = getState().expandedProviders[provider] ?? true;
      set({ expandedProviders: { ...getState().expandedProviders, [provider]: !current } });
    },

    async openApiKeyEditor(provider) {
      const keyPrefix = provider.configured ? await sceneCredentialPrefix(provider.provider) : null;
      set({
        editingProvider: provider,
        apiKeyInput: "",
        apiKeyError: null,
        apiKeySaving: false,
        keyPrefix,
      });
    },

    closeApiKeyEditor() {
      set({ editingProvider: null, apiKeyInput: "", apiKeyError: null, apiKeySaving: false, keyPrefix: null });
    },

    setApiKeyInput(apiKeyInput) {
      set({ apiKeyInput });
    },

    async saveApiKey() {
      const provider = getState().editingProvider;
      const key = getState().apiKeyInput.trim();
      if (!provider) return;
      if (!key) {
        set({ apiKeyError: t("Key cannot be empty.") });
        return;
      }
      set({ apiKeySaving: true, apiKeyError: null });
      const resp = await (async () => {
        try {
          await storeSystemCredential(provider.provider, key);
          return await call("set_api_key", { provider: provider.provider, apiKey: key });
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      })();
      if (!resp?.ok) {
        set({ apiKeyError: resp?.error || "Failed to save key.", apiKeySaving: false });
        return;
      }
      set({ editingProvider: null, apiKeySaving: false });
      await refreshEverything();
    },

    async removeApiKey(provider) {
      const ok = confirmImpl(
        `Remove stored API key for ${provider.displayName || provider.provider}?`,
      );
      if (!ok) return;
      try {
        await deleteSystemCredential(provider.provider);
      } catch (error) {
        if (typeof globalThis.alert === "function") {
          globalThis.alert(
            error instanceof Error ? error.message : "Failed to remove system credential.",
          );
        }
        return;
      }
      const resp = await call("remove_api_key", { provider: provider.provider }).catch(() => null);
      if (resp?.ok) await refreshEverything();
    },

    async checkModelHealth(provider) {
      const state = getState();
      const checking = state.providers
        .find((entry) => entry.provider === provider)
        ?.models?.filter(
          (model) => model.visible !== false && model.available !== false,
        )
        .map((model) => `${provider}::${model.id}`) ?? [];
      set({ checkingModels: checking });
      const resp = await call("check_model_health", { provider }, { timeoutMs: HEALTH_CHECK_TIMEOUT_MS }).catch(
        (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      ) as ConfigGatewayResult;
      if (resp?.ok && Array.isArray(resp.data?.results)) {
        const results = new Map(
          (resp.data.results ?? []).map((result) => [
            `${result.provider}::${result.modelId}`,
            { status: result.status, latencyMs: result.latencyMs, error: result.error },
          ]),
        );
        set({
          providers: getState().providers.map((entry) => ({
            ...entry,
            models: entry.models?.map((model) => {
              const health = results.get(`${entry.provider}::${model.id}`);
              return health ? { ...model, health } : model;
            }),
          })),
          checkingModels: [],
        });
        return;
      }
      const message = resp?.error || "Health check failed";
      set({
        providers: getState().providers.map((entry) =>
          entry.provider === provider
            ? {
                ...entry,
                models: entry.models?.map((model) =>
                  model.visible !== false && model.available !== false
                    ? { ...model, health: { status: "unknown", error: message } }
                    : model,
                ),
              }
            : entry,
        ),
        checkingModels: [],
      });
    },

    async setModelVisibility(provider, modelId, visible) {
      set({ visibilitySaving: true });
      const resp = await call("set_model_visibility", { provider, modelId, visible }).catch(
        () => null,
      );
      if (!resp?.ok) {
        set({ visibilitySaving: false });
        return;
      }
      await getState().loadApiKeys({ preserveUi: true });
      set({ visibilitySaving: false });
      void options.onModelConfigurationChanged?.();
    },

    async setAllModelsVisibility(provider, visible) {
      const models = getState()
        .providers.find((entry) => entry.provider === provider)
        ?.models?.filter((model) => (model.visible !== false) !== visible) ?? [];
      if (models.length === 0) return;
      set({ visibilitySaving: true });
      for (const model of models) {
        const resp = await call("set_model_visibility", {
          provider,
          modelId: model.id,
          visible,
        }).catch(() => null);
        if (!resp?.ok) {
          set({ visibilitySaving: false });
          return;
        }
      }
      await getState().loadApiKeys({ preserveUi: true });
      set({ visibilitySaving: false });
      void options.onModelConfigurationChanged?.();
    },

    async loadChannels() {
      set({ channelStatus: "loading" });
      const response = await call("list_provider_channels").catch((error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }) as ConfigGatewayResult);
      if (!response?.ok) {
        set({ channelStatus: "error", channelError: response?.error || "Failed to load channels." });
        return;
      }
      const channels = Array.isArray(response.data?.channels) ? response.data.channels : [];
      const qveris = channels.find((channel) => channel.builtIn === true);
      if (
        qveris?.configured === true &&
        (!Array.isArray(qveris.models) || qveris.models.length === 0) &&
        !qverisAutoSyncAttempted
      ) {
        qverisAutoSyncAttempted = true;
        const synced = await (async () => {
          const resp = await call("sync_qveris_models", {}, { timeoutMs: 30_000 }).catch(
            (error: unknown) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          ) as ConfigGatewayResult;
          if (!resp?.ok) {
            set({ channelError: resp?.error || "Failed to load QVeris models." });
            return false;
          }
          await refreshEverything();
          return true;
        })();
        if (synced) {
          set({ channelStatus: "ready", channelError: null });
          return;
        }
      }
      set({ channelStatus: "ready", channelError: null, channels });
    },

    async openChannelEditor(channel) {
      let keyPrefix: string | null = null;
      if (channel?.configured && channel.provider) {
        keyPrefix = await sceneCredentialPrefix(channel.provider);
      }
      set({
        channelEditor: {
          originalProvider: channel?.provider || "",
          provider: channel?.provider || "",
          baseUrl: channel?.baseUrl || "",
          api: channel?.api || "openai-completions",
          apiKey: "",
          modelsText: (channel?.models || [])
            .map((model) => model?.id)
            .filter(Boolean)
            .join("\n"),
          keyPrefix,
        },
        channelSaving: false,
        channelEditorError: null,
      });
    },

    closeChannelEditor() {
      set({ channelEditor: null, channelSaving: false, channelEditorError: null });
    },

    setChannelForm(patch) {
      const current = getState().channelEditor;
      set({ channelEditor: current ? { ...current, ...patch } : null });
    },

    async saveChannel() {
      const form = getState().channelEditor;
      if (!form) return;
      const models = form.modelsText
        .split(/\r?\n/)
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => ({ id }));
      const editingQVeris = form.originalProvider === "qveris";
      if (models.length === 0 && !editingQVeris) {
        set({ channelEditorError: "Add at least one model ID." });
        return;
      }
      set({ channelSaving: true });
      const provider = form.provider.trim();
      const apiKey = form.apiKey.trim();
      let response: ConfigGatewayResult | null = null;
      try {
        if (apiKey) await storeSystemCredential(provider, apiKey);
        response = await call("save_provider_channel", {
          originalProvider: form.originalProvider,
          provider,
          baseUrl: form.baseUrl.trim(),
          api: form.api,
          apiKey,
          authHeader: true,
          models,
        });
      } catch (error) {
        response = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!response?.ok) {
        set({
          channelSaving: false,
          channelEditorError: response?.error || "Failed to save model channel.",
        });
        return;
      }
      if (form.originalProvider && form.originalProvider !== provider) {
        await deleteSystemCredential(form.originalProvider).catch(() => {});
      }
      set({ channelEditor: null, channelSaving: false, channelError: null, channelEditorError: null });
      await refreshEverything();
    },

    async removeChannel(channel) {
      const ok = confirmImpl(
        `Remove model channel "${channel.provider}" and its stored key?`,
      );
      if (!ok) return;
      try {
        await deleteSystemCredential(channel.provider || "");
      } catch (error) {
        set({
          channelError:
            (error instanceof Error ? error.message : String(error)) ||
            "Failed to remove system credential.",
        });
        return;
      }
      const result = await call("remove_provider_channel", { provider: channel.provider }).catch(
        (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      ) as ConfigGatewayResult;
      if (!result?.ok) {
        set({ channelError: result?.error || "Failed to remove channel." });
        return;
      }
      await refreshEverything();
    },

    async loadConfigEditor() {
      set({ configEditor: { ...getState().configEditor, loading: true, message: null, path: "Loading…" } });
      try {
        const data = await call("read_agent_config");
        if (!data?.ok) throw new Error(data?.error || "Failed to load config");
        let content = data.data?.content ?? "";
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          // Keep raw content when it is not valid JSON.
        }
        set({ configEditor: { content, path: data.data?.path || "", loading: false, message: null, saving: false } });
      } catch (error) {
        set({
          configEditor: {
            content: "",
            path: "",
            loading: false,
            message: {
              message: error instanceof Error ? error.message : String(error),
              tone: "error",
            },
            saving: false,
          },
        });
      }
    },

    async saveConfigEditor() {
      const content = getState().configEditor.content;
      try {
        JSON.parse(content);
      } catch (error) {
        set({
          configEditor: {
            ...getState().configEditor,
            message: {
              message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
              tone: "error",
            },
          },
        });
        return;
      }
      set({ configEditor: { ...getState().configEditor, saving: true } });
      try {
        const data = await call("write_agent_config", { content });
        if (!data?.ok) throw new Error(data?.error || "Failed to save config");
        set({
          configEditor: {
            ...getState().configEditor,
            saving: false,
            message: { message: t("Saved"), tone: "ok" },
          },
        });
      } catch (error) {
        set({
          configEditor: {
            ...getState().configEditor,
            saving: false,
            message: {
              message: error instanceof Error ? error.message : String(error),
              tone: "error",
            },
          },
        });
      }
    },

    async loadModelsEditor() {
      set({ modelsEditor: { ...getState().modelsEditor, loading: true, message: null, path: "Loading…" } });
      try {
        const data = await call("read_models_config");
        if (!data?.ok) throw new Error(data?.error || "Failed to load models.json");
        let content = data.data?.content ?? "";
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          // Keep raw content when it is not valid JSON.
        }
        set({ modelsEditor: { content, path: data.data?.path || "", loading: false, message: null, saving: false } });
      } catch (error) {
        set({
          modelsEditor: {
            content: "",
            path: "",
            loading: false,
            message: {
              message: error instanceof Error ? error.message : String(error),
              tone: "error",
            },
            saving: false,
          },
        });
      }
    },

    async saveModelsEditor() {
      const content = getState().modelsEditor.content;
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            message: {
              message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
              tone: "error",
            },
          },
        });
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            message: { message: "models.json must be a JSON object.", tone: "error" },
          },
        });
        return;
      }
      const providersField = (parsed as Record<string, unknown>).providers;
      if ("providers" in (parsed as Record<string, unknown>) &&
          (typeof providersField !== "object" || Array.isArray(providersField))) {
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            message: { message: "'providers' must be an object.", tone: "error" },
          },
        });
        return;
      }
      set({ modelsEditor: { ...getState().modelsEditor, saving: true } });
      try {
        const data = await call("write_models_config", { content });
        if (!data?.ok) throw new Error(data?.error || "Failed to save models.json");
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            saving: false,
            message: { message: t("Saved"), tone: "ok" },
          },
        });
        void options.onModelConfigurationChanged?.();
      } catch (error) {
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            saving: false,
            message: {
              message: error instanceof Error ? error.message : String(error),
              tone: "error",
            },
          },
        });
      }
    },

    insertModelsExample() {
      const current = getState().modelsEditor.content.trim();
      if (current && current !== "{}" && current !== '{\n  "providers": {}\n}') {
        if (!confirmImpl("Replace current content with the Ollama example?")) return;
      }
      set({
        modelsEditor: {
          ...getState().modelsEditor,
          content: MODELS_JSON_EXAMPLE,
          message: null,
        },
      });
    },

    openModelsDocs() {
      call("open_external", { url: MODELS_DOCS_URL }).catch(() => {
        globalThis.open(MODELS_DOCS_URL, "_blank", "noopener,noreferrer");
      });
    },
  }));

  return store;
}

export type ConfigStore = ReturnType<typeof createConfigStore>;
