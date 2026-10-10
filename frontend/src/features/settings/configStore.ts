import { create } from "zustand";
import { localizeHostError } from "../../shared/hostErrors";
import { t } from "../../shared/i18n";
import { channelModelDetailsJson, channelModelsFromDetails } from "./channelModelDetails";
import { fallbackSceneProfiles } from "./sceneProfiles";

function localizeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) return fallback;
  return localizeHostError(new Error(message)).message;
}

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
  catalogSync?: "qveris" | "openai" | null;
  enabled?: boolean;
  authHeader?: boolean;
  provider?: string;
  displayName?: string;
  builtIn?: boolean;
  baseUrl?: string;
  api?: string;
  models?: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }>;
  configured?: boolean;
  revision?: string;
}

export interface ConfigGatewayResult {
  ok?: boolean;
  error?: string;
  data?: {
    providers?: ConfigProvider[];
    channels?: ProviderChannel[];
    channel?: ProviderChannel;
    connection?: { status?: string; method?: string; modelCount?: number; latencyMs?: number; error?: string };
    models?: string[];
    revision?: string;
    provider?: string;
    enabled?: boolean;
    runtimeReady?: boolean;
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
  call(op: string, params?: unknown, options?: { timeoutMs?: number; target?: unknown }): Promise<ConfigGatewayResult>;
}

export interface ConfigStoreOptions {
  configGateway: ConfigGatewayLike;
  getTarget?: () => { sceneId?: string } | null;
  onModelConfigurationChanged?: () => void | Promise<void>;
  invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
  confirmImpl?: (message: string) => boolean | Promise<boolean>;
}

interface EditorMessage {
  message: string;
  tone: "ok" | "error";
}

export interface ChannelEditorForm {
  sceneId: string;
  authHeader: boolean;
  originalProvider: string;
  provider: string;
  displayName: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  modelsText: string;
  modelDetailsJson: string;
  keyPrefix: string | null;
  expectedRevision: string;
  copySourceProvider?: string;
  copySourceRevision?: string;
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
  testingChannel: string | null;
  channelCheck: { provider: string; message: string; ok: boolean } | null;
  channelEditor: ChannelEditorForm | null;
  channelSaving: boolean;
  channelEditorError: string | null;
  channelEditorNotice: string | null;
  configEditor: { content: string; path: string; loading: boolean; message: EditorMessage | null; saving: boolean };
  modelsEditor: { content: string; path: string; revision?: string; loading: boolean; message: EditorMessage | null; saving: boolean };
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
  duplicateChannel(channel: ProviderChannel): void;
  closeChannelEditor(): void;
  setChannelForm(patch: Partial<ChannelEditorForm>): void;
  syncingChannel: string | null;
  togglingChannel: string | null;
  syncChannel(channel: ProviderChannel): Promise<void>;
  setChannelEnabled(channel: ProviderChannel, enabled: boolean): Promise<void>;
  testChannelConnection(channel: ProviderChannel): Promise<void>;
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
  let sceneGeneration = 0;

  function activeSceneId(): string {
    const sceneId = options.getTarget?.()?.sceneId;
    return typeof sceneId === "string" && sceneId.trim() ? sceneId.trim() : "programming";
  }

  async function storeSystemCredential(sceneId: string, provider: string, secret: string): Promise<void> {
    if (!invoke) return;
    await invoke("store_scene_credential", { sceneId, provider, secret });
  }

  function isCurrentScene(sceneId: string, generation: number): boolean {
    return activeSceneId() === sceneId && sceneGeneration === generation;
  }

  async function deleteSystemCredential(sceneId: string, provider: string): Promise<void> {
    if (!invoke) return;
    await invoke("delete_scene_credential", { sceneId, provider });
  }

  async function sceneCredentialPrefix(sceneId: string, provider: string): Promise<string | null> {
    if (!invoke) return null;
    try {
      const status = (await invoke("scene_credential_status", {
        sceneId,
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
    testingChannel: null,
    channelCheck: null,
    togglingChannel: null,
    channelEditor: null,
    channelSaving: false,
    channelEditorError: null,
    channelEditorNotice: null,
    configEditor: { content: "", path: "", loading: false, message: null, saving: false },
    modelsEditor: { content: "", path: "", revision: "", loading: false, message: null, saving: false },

    setTarget(target) {
      const sceneId =
        typeof target?.sceneId === "string" && target.sceneId.trim()
          ? target.sceneId.trim()
          : "programming";
      if (sceneId === getState().sceneId) return;
      sceneGeneration += 1;
      set({
        sceneId,
        sceneName: sceneNameFor(sceneId),
        providers: [],
        channels: [],
        apiStatus: "idle",
        apiError: null,
        channelStatus: "idle",
        channelError: null,
        testingChannel: null,
        channelCheck: null,
        checkingModels: [],
        visibilitySaving: false,
        syncingChannel: null,
        togglingChannel: null,
        editingProvider: null,
        apiKeyInput: "",
        apiKeyError: null,
        apiKeySaving: false,
        keyPrefix: null,
        channelEditor: null,
        channelSaving: false,
        channelEditorError: null,
        channelEditorNotice: null,
        configEditor: { content: "", path: "", loading: false, message: null, saving: false },
        modelsEditor: { content: "", path: "", revision: "", loading: false, message: null, saving: false },
      });
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
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      set({ apiStatus: preserveUi ? getState().apiStatus : "loading" });
      const data = await call("list_model_catalog").catch((error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }) as ConfigGatewayResult);
      if (!isCurrentScene(sceneId, generation)) return;
      if (!data?.ok || !Array.isArray(data.data?.providers)) {
        set({
          apiStatus: "error",
          apiError: localizeError(data?.error, t("Failed to load providers.")),
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
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const keyPrefix = provider.configured ? await sceneCredentialPrefix(sceneId, provider.provider) : null;
      if (!isCurrentScene(sceneId, generation)) return;
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
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const target = options.getTarget?.() ?? undefined;
      const provider = getState().editingProvider;
      const key = getState().apiKeyInput.trim();
      if (!provider) return;
      if (options.getTarget && !target) {
        set({ apiKeyError: t("No active scene session for configuration.") });
        return;
      }
      if (!key) {
        set({ apiKeyError: t("Key cannot be empty.") });
        return;
      }
      set({ apiKeySaving: true, apiKeyError: null });
      let systemCredentialUpdated = false;
      const resp = await (async () => {
        try {
          await storeSystemCredential(sceneId, provider.provider, key);
          systemCredentialUpdated = Boolean(invoke);
          return await call("set_api_key", { provider: provider.provider, apiKey: key }, { target });
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      })();
      if (!isCurrentScene(sceneId, generation)) return;
      if (!resp?.ok) {
        set({
          apiKeyError: `${localizeError(resp?.error, t("Failed to save key."))}${systemCredentialUpdated ? ` ${t("The system credential was updated. Review this scene before retrying.")}` : ""}`,
          apiKeySaving: false,
        });
        return;
      }
      set({ editingProvider: null, apiKeySaving: false });
      await refreshEverything();
    },

    async removeApiKey(provider) {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const target = options.getTarget?.() ?? undefined;
      if (options.getTarget && !target) {
        set({ apiError: t("No active scene session for configuration.") });
        return;
      }
      const ok = await confirmImpl(
        `Remove stored API key for ${provider.displayName || provider.provider}?`,
      );
      if (!ok || !isCurrentScene(sceneId, generation)) return;
      try {
        await deleteSystemCredential(sceneId, provider.provider);
      } catch (error) {
        if (!isCurrentScene(sceneId, generation)) return;
        if (typeof globalThis.alert === "function") {
          globalThis.alert(
            localizeError(error, t("Failed to remove system credential.")),
          );
        }
        return;
      }
      const resp = await call("remove_api_key", { provider: provider.provider }, { target }).catch(() => null);
      if (isCurrentScene(sceneId, generation) && !resp?.ok) {
        set({ apiError: t("The system credential was removed. Verify the model configuration before retrying.") });
      }
      if (isCurrentScene(sceneId, generation) && resp?.ok) await refreshEverything();
    },

    async checkModelHealth(provider) {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
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
      if (!isCurrentScene(sceneId, generation)) return;
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
      const message = localizeError(resp?.error, t("Health check failed"));
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
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      set({ visibilitySaving: true });
      const resp = await call("set_model_visibility", { provider, modelId, visible }).catch(
        () => null,
      );
      if (!isCurrentScene(sceneId, generation)) return;
      if (!resp?.ok) {
        set({ visibilitySaving: false });
        return;
      }
      await getState().loadApiKeys({ preserveUi: true });
      if (!isCurrentScene(sceneId, generation)) return;
      set({ visibilitySaving: false });
      void options.onModelConfigurationChanged?.();
    },

    async setAllModelsVisibility(provider, visible) {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const models = getState()
        .providers.find((entry) => entry.provider === provider)
        ?.models?.filter((model) => (model.visible !== false) !== visible) ?? [];
      if (models.length === 0) return;
      set({ visibilitySaving: true });
      for (const model of models) {
        if (!isCurrentScene(sceneId, generation)) return;
        const resp = await call("set_model_visibility", {
          provider,
          modelId: model.id,
          visible,
        }).catch(() => null);
        if (!isCurrentScene(sceneId, generation)) return;
        if (!resp?.ok) {
          set({ visibilitySaving: false });
          return;
        }
      }
      await getState().loadApiKeys({ preserveUi: true });
      if (!isCurrentScene(sceneId, generation)) return;
      set({ visibilitySaving: false });
      void options.onModelConfigurationChanged?.();
    },

    async loadChannels() {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      set({ channelStatus: "loading", channelCheck: null });
      const response = await call("list_provider_channels").catch((error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }) as ConfigGatewayResult);
      if (!isCurrentScene(sceneId, generation)) return;
      if (!response?.ok) {
        set({
          channelStatus: "error",
          channelError: localizeError(
            response?.error,
            t("Failed to load channels."),
          ),
        });
        return;
      }
      const channels = Array.isArray(response.data?.channels) ? response.data.channels : [];
      set({ channelStatus: "ready", channelError: null, channels });
    },

    syncingChannel: null,
    async setChannelEnabled(channel, enabled) {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const target = options.getTarget?.() ?? undefined;
      if (options.getTarget && !target) {
        set({ channelError: t("No active scene session for configuration.") });
        return;
      }
      const state = getState();
      if (state.channelEditor) {
        set({ channelError: t("Save or cancel the open channel editor first.") });
        return;
      }
      if (
        state.channelStatus !== "ready" ||
        state.togglingChannel ||
        state.syncingChannel ||
        state.testingChannel ||
        state.channelSaving ||
        !channel.provider
      ) return;
      if (
        state.channels.find((entry) => entry.provider === channel.provider)?.revision !== channel.revision
      ) {
        set({ channelError: t("Model channel changed while syncing. Refresh and try again.") });
        return;
      }
      if (!channel.revision) {
        set({ channelError: t("Channel revision is unavailable. Refresh or update the desktop runtime before editing.") });
        return;
      }
      set({ togglingChannel: channel.provider, channelError: null, channelCheck: null });
      const response = await call("set_provider_channel_enabled", {
        provider: channel.provider,
        enabled,
        expectedRevision: channel.revision,
      }, { target }).catch((reason: unknown) => ({
        ok: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }) as ConfigGatewayResult);
      if (!isCurrentScene(sceneId, generation)) return;
      if (
        response?.ok !== true ||
        response.data?.provider !== channel.provider ||
        response.data?.enabled !== enabled
      ) {
        await refreshEverything();
        if (isCurrentScene(sceneId, generation)) {
          const saved = getState().channelStatus === "ready" &&
            getState().channels.find((entry) => entry.provider === channel.provider)?.enabled === enabled;
          set({
            togglingChannel: null,
            channelError: saved
              ? t("Channel state changed, but runtime refresh is unconfirmed. Review this scene before making requests.")
              : localizeError(response?.error, t("Could not change model channel state. Refresh and retry.")),
          });
        }
        return;
      }
      await refreshEverything();
      if (isCurrentScene(sceneId, generation)) {
        set({
          togglingChannel: null,
          ...(getState().channelStatus !== "ready"
            ? { channelError: t("Channel state was saved, but the channel list could not be refreshed. Reload this scene.") }
            : response.data?.runtimeReady !== true
              ? { channelError: t("Channel state was saved, but runtime refresh is unconfirmed. Review this scene before making requests.") }
              : {}),
        });
      }
    },
    async testChannelConnection(channel) {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const target = options.getTarget?.() ?? undefined;
      if (options.getTarget && !target) {
        set({ channelError: t("No active scene session for configuration.") });
        return;
      }
      if (!channel.provider || channel.enabled === false || getState().channelStatus !== "ready" || getState().testingChannel || getState().togglingChannel) return;
      set({ testingChannel: channel.provider, channelCheck: null });
      const response = await call("test_provider_channel", { provider: channel.provider }, { target, timeoutMs: HEALTH_CHECK_TIMEOUT_MS }).catch(
        (reason: unknown) => ({ ok: false, error: reason instanceof Error ? reason.message : String(reason) }),
      ) as ConfigGatewayResult;
      if (!isCurrentScene(sceneId, generation)) return;
      const result = response?.data?.connection;
      const ok = response?.ok === true && result?.status === "connected";
      const detail = response?.ok ? result?.error : response?.error;
      const message = ok
        ? `${t("Connection successful")} (${result?.latencyMs ?? 0} ms${result?.method === "catalog" ? `, ${t("{count} models found").replace("{count}", String(result.modelCount ?? 0))}` : ""})`
        : `${t("Connection failed")}${detail ? `: ${localizeError(detail, t("Connection failed"))}` : ""}`;
      set({ testingChannel: null, channelCheck: { provider: channel.provider, message, ok } });
    },
    async syncChannel(channel) {
      if (!channel.catalogSync || channel.enabled === false || getState().syncingChannel || getState().togglingChannel) return;
      if (channel.catalogSync === "openai" && getState().channelEditor) {
        set({ channelError: t("Save or cancel the open channel editor first.") });
        return;
      }
      const scene = activeSceneId();
      const generation = sceneGeneration;
      set({ syncingChannel: channel.provider || null, channelError: null });
      try {
        const response = channel.catalogSync === "qveris"
          ? await call("sync_qveris_models", {}, { timeoutMs: 30_000 })
          : await call("discover_provider_models", { provider: channel.provider }, { timeoutMs: 30_000 });
        if (!isCurrentScene(scene, generation)) return;
        if (!response?.ok) throw new Error(response?.error || t("Failed to refresh model catalog."));
        if (channel.catalogSync === "qveris") {
          await refreshEverything();
          return;
        }
        const found = response.data?.models;
        const revision = response.data?.revision;
        const snapshot = response.data?.channel;
        if (
          !Array.isArray(found) ||
          !found.every((id) => typeof id === "string") ||
          !revision ||
          !snapshot ||
          snapshot.provider !== channel.provider ||
          typeof snapshot.baseUrl !== "string" ||
          typeof snapshot.api !== "string" ||
          !Array.isArray(snapshot.models)
        ) {
          throw new Error(t("Model catalog returned an invalid result."));
        }
        await getState().openChannelEditor({ ...snapshot, configured: channel.configured });
        const editor = getState().channelEditor;
        if (!isCurrentScene(scene, generation) || !editor || editor.originalProvider !== channel.provider) return;
        const existing = editor.modelsText.split(/\r?\n/).filter(Boolean);
        const additions = found.filter((id) => !existing.includes(id));
        set({
          channelEditor: {
            ...editor,
            modelsText: [...existing, ...additions].join("\n"),
            expectedRevision: revision,
          },
          channelEditorNotice: t("Found {count} model IDs. Review and save the channel.").replace("{count}", String(found.length)),
        });
      } catch (reason) {
        if (isCurrentScene(scene, generation)) set({ channelError: localizeError(reason, t("Failed to refresh model catalog.")) });
      } finally {
        if (isCurrentScene(scene, generation)) set({ syncingChannel: null });
      }
    },

    async openChannelEditor(channel) {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      let keyPrefix: string | null = null;
      if (channel?.configured && channel.provider) {
        keyPrefix = await sceneCredentialPrefix(sceneId, channel.provider);
      }
      if (!isCurrentScene(sceneId, generation)) return;
      set({
        channelEditor: {
          sceneId,
          originalProvider: channel?.provider || "",
          provider: channel?.provider || "",
          displayName: channel?.displayName || "",
          baseUrl: channel?.baseUrl || "",
          api: channel?.api || "openai-completions",
          authHeader: channel?.authHeader !== false,
          apiKey: "",
          modelsText: (channel?.models || [])
            .map((model) => model?.id)
            .filter(Boolean)
            .join("\n"),
          modelDetailsJson: channelModelDetailsJson(channel?.models || []),
          keyPrefix,
          expectedRevision: channel?.revision || "",
        },
        channelSaving: false,
        channelEditorError: null,
        channelEditorNotice: null,
      });
    },

    duplicateChannel(channel) {
      const source = getState().channels.find((entry) => entry.provider === channel.provider);
      if (getState().channelStatus !== "ready" || !source?.provider) return;
      if (!source.revision) {
        set({ channelError: t("Channel revision is unavailable. Refresh or update the desktop runtime before copying.") });
        return;
      }
      set({
        channelEditor: {
          sceneId: activeSceneId(),
          originalProvider: "",
          provider: "",
          displayName: source.displayName || "",
          baseUrl: source.baseUrl || "",
          api: source.api || "openai-completions",
          authHeader: source.authHeader !== false,
          apiKey: "",
          modelsText: (source.models || []).map((model) => model?.id).filter(Boolean).join("\n"),
          modelDetailsJson: channelModelDetailsJson(source.models || []),
          keyPrefix: null,
          expectedRevision: "",
          copySourceProvider: source.provider,
          copySourceRevision: source.revision,
        },
        channelSaving: false,
        channelEditorError: null,
        channelEditorNotice: t("Choose a new channel ID. Enter a key separately if this channel needs one."),
      });
    },

    closeChannelEditor() {
      set({ channelEditor: null, channelSaving: false, channelEditorError: null, channelEditorNotice: null });
    },

    setChannelForm(patch) {
      const current = getState().channelEditor;
      set({ channelEditor: current ? { ...current, ...patch } : null });
    },

    async saveChannel() {
      const form = getState().channelEditor;
      if (!form) return;
      const generation = sceneGeneration;
      const target = options.getTarget?.() ?? undefined;
      if (options.getTarget && !target) {
        set({ channelEditorError: t("No active scene session for configuration.") });
        return;
      }
      if (form.sceneId !== activeSceneId()) {
        set({ channelEditorError: t("The active scene changed. Reopen this channel before saving.") });
        return;
      }
      if (form.originalProvider && !form.expectedRevision) {
        set({ channelEditorError: t("Channel revision is unavailable. Refresh or update the desktop runtime before editing.") });
        return;
      }
      const modelIds = form.modelsText
        .split(/\r?\n/)
        .map((id) => id.trim())
        .filter(Boolean);
      const canDiscoverModels = ["openai-completions", "openai-responses"].includes(form.api);
      if (modelIds.length === 0 && !canDiscoverModels) {
        set({ channelEditorError: "Add at least one model ID." });
        return;
      }
      let models: ReturnType<typeof channelModelsFromDetails>;
      try {
        models = modelIds.length ? channelModelsFromDetails(modelIds, form.modelDetailsJson) : [];
      } catch (error) {
        set({ channelEditorError: t(error instanceof Error ? error.message : "Model details must be valid JSON.") });
        return;
      }
      set({ channelSaving: true });
      const provider = form.provider.trim();
      const writesNewId = !form.originalProvider || form.originalProvider !== provider;
      if (writesNewId && getState().channels.some((channel) => channel.provider === provider)) {
        set({ channelSaving: false, channelEditorError: t("A channel with this ID already exists.") });
        return;
      }
      const apiKey = form.authHeader ? form.apiKey.trim() : "";
      let systemCredentialUpdated = false;
      let credentialSyncWarning = "";
      let response: ConfigGatewayResult | null = null;
      try {
        if (apiKey && !writesNewId) {
          await storeSystemCredential(form.sceneId, provider, apiKey);
          systemCredentialUpdated = Boolean(invoke);
        }
        response = await call("save_provider_channel", {
          originalProvider: form.originalProvider,
          provider,
          displayName: form.displayName.trim(),
          baseUrl: form.baseUrl.trim(),
          api: form.api,
          apiKey,
          authHeader: form.authHeader,
          models,
          expectedRevision: form.expectedRevision,
          createOnly: !form.originalProvider,
          copySourceProvider: form.copySourceProvider,
          copySourceRevision: form.copySourceRevision,
        }, { target });
      } catch (error) {
        response = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!response?.ok) {
        if (!isCurrentScene(form.sceneId, generation)) return;
        set({
          channelSaving: false,
          channelEditorError: `${localizeError(response?.error, t("Failed to save model channel."))}${systemCredentialUpdated ? ` ${t("The system credential was updated. Review this scene before retrying.")}` : ""}`,
        });
        return;
      }
      if (apiKey && writesNewId) {
        try {
          await storeSystemCredential(form.sceneId, provider, apiKey);
        } catch {
          credentialSyncWarning = t("Channel saved, but its system credential could not be updated. Check this scene's key.");
        }
      }
      let cleanupWarning = "";
      if (form.originalProvider && form.originalProvider !== provider && !credentialSyncWarning) {
        await deleteSystemCredential(form.sceneId, form.originalProvider).catch(() => {
          cleanupWarning = t("The previous credential could not be removed.");
        });
      }
      if (!isCurrentScene(form.sceneId, generation)) return;
      set({
        channelEditor: null,
        channelSaving: false,
        channelError: null,
        channelEditorError: null,
        channelEditorNotice: null,
      });
      await refreshEverything();
      if ((credentialSyncWarning || cleanupWarning) && isCurrentScene(form.sceneId, generation)) {
        set({ channelError: credentialSyncWarning || cleanupWarning });
      }
    },

    async removeChannel(channel) {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const target = options.getTarget?.() ?? undefined;
      if (options.getTarget && !target) {
        set({ channelError: t("No active scene session for configuration.") });
        return;
      }
      if (!channel.revision) {
        set({ channelError: t("Channel revision is unavailable. Refresh or update the desktop runtime before editing.") });
        return;
      }
      const ok = await confirmImpl(
        `Remove model channel "${channel.provider}" and its stored key?`,
      );
      if (!ok || !isCurrentScene(sceneId, generation)) return;
      const result = await call("remove_provider_channel", { provider: channel.provider, expectedRevision: channel.revision }, { target }).catch(
        (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      ) as ConfigGatewayResult;
      if (!result?.ok) {
        if (isCurrentScene(sceneId, generation)) {
          await refreshEverything();
        }
        if (isCurrentScene(sceneId, generation)) {
          set({ channelError: localizeError(result?.error, t("Failed to remove channel.")) });
        }
        return;
      }
      let credentialWarning = "";
      await deleteSystemCredential(sceneId, channel.provider || "").catch(() => {
        credentialWarning = t("The previous credential could not be removed.");
      });
      if (!isCurrentScene(sceneId, generation)) return;
      await refreshEverything();
      if (credentialWarning && isCurrentScene(sceneId, generation)) set({ channelError: credentialWarning });
    },

    async loadConfigEditor() {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      set({ configEditor: { ...getState().configEditor, loading: true, message: null, path: "Loading…" } });
      try {
        const data = await call("read_agent_config");
        if (!isCurrentScene(sceneId, generation)) return;
        if (!data?.ok) throw new Error(data?.error || t("Failed to load config"));
        let content = data.data?.content ?? "";
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          // Keep raw content when it is not valid JSON.
        }
        set({ configEditor: { content, path: data.data?.path || "", loading: false, message: null, saving: false } });
      } catch (error) {
        if (!isCurrentScene(sceneId, generation)) return;
        set({
          configEditor: {
            content: "",
            path: "",
            loading: false,
            message: {
              message: localizeError(error, t("Failed to load config")),
              tone: "error",
            },
            saving: false,
          },
        });
      }
    },

    async saveConfigEditor() {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const content = getState().configEditor.content;
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        set({
          configEditor: {
            ...getState().configEditor,
            message: {
              message: t("Invalid JSON"),
              tone: "error",
            },
          },
        });
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        set({
          configEditor: {
            ...getState().configEditor,
            message: { message: t("Configuration must be a JSON object."), tone: "error" },
          },
        });
        return;
      }
      set({ configEditor: { ...getState().configEditor, saving: true } });
      try {
        const data = await call("write_agent_config", { content });
        if (!isCurrentScene(sceneId, generation)) return;
        if (!data?.ok) throw new Error(data?.error || t("Failed to save config"));
        set({
          configEditor: {
            ...getState().configEditor,
            saving: false,
            message: { message: t("Saved"), tone: "ok" },
          },
        });
      } catch (error) {
        if (!isCurrentScene(sceneId, generation)) return;
        set({
          configEditor: {
            ...getState().configEditor,
            saving: false,
            message: {
              message: localizeError(error, t("Failed to save config")),
              tone: "error",
            },
          },
        });
      }
    },

    async loadModelsEditor() {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      set({ modelsEditor: { ...getState().modelsEditor, loading: true, message: null, path: "Loading…" } });
      try {
        const data = await call("read_models_config");
        if (!isCurrentScene(sceneId, generation)) return;
        if (!data?.ok) {
          throw new Error(data?.error || t("Failed to load models config"));
        }
        let content = data.data?.content ?? "";
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          // Keep raw content when it is not valid JSON.
        }
        set({ modelsEditor: { content, path: data.data?.path || "", revision: data.data?.revision || "", loading: false, message: null, saving: false } });
      } catch (error) {
        if (!isCurrentScene(sceneId, generation)) return;
        set({
          modelsEditor: {
            content: "",
            path: "",
            revision: "",
            loading: false,
            message: {
              message: localizeError(error, t("Failed to load models config")),
              tone: "error",
            },
            saving: false,
          },
        });
      }
    },

    async saveModelsEditor() {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const content = getState().modelsEditor.content;
      const expectedRevision = getState().modelsEditor.revision;
      if (!expectedRevision) {
        set({ modelsEditor: { ...getState().modelsEditor, message: { message: t("Channel revision is unavailable. Refresh or update the desktop runtime before editing."), tone: "error" } } });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            message: {
              message: t("Invalid JSON"),
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
            message: { message: t("Configuration must be a JSON object."), tone: "error" },
          },
        });
        return;
      }
      const providersField = (parsed as Record<string, unknown>).providers;
      if ("providers" in (parsed as Record<string, unknown>) &&
          (!providersField || typeof providersField !== "object" || Array.isArray(providersField))) {
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            message: { message: t("'providers' must be an object."), tone: "error" },
          },
        });
        return;
      }
      set({ modelsEditor: { ...getState().modelsEditor, saving: true } });
      try {
        const data = await call("write_models_config", { content, expectedRevision });
        if (!isCurrentScene(sceneId, generation)) return;
        if (!data?.ok) throw new Error(data?.error || "Failed to save models.json");
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            revision: data.data?.revision || "",
            saving: false,
            message: { message: t("Saved"), tone: "ok" },
          },
        });
        void options.onModelConfigurationChanged?.();
      } catch (error) {
        if (!isCurrentScene(sceneId, generation)) return;
        set({
          modelsEditor: {
            ...getState().modelsEditor,
            saving: false,
            message: {
              message: localizeError(error, t("Failed to save models config")),
              tone: "error",
            },
          },
        });
      }
    },

    async insertModelsExample() {
      const sceneId = activeSceneId();
      const generation = sceneGeneration;
      const current = getState().modelsEditor.content.trim();
      if (current && current !== "{}" && current !== '{\n  "providers": {}\n}') {
        if (!(await confirmImpl("Replace current content with the Ollama example?"))) return;
      }
      if (!isCurrentScene(sceneId, generation)) return;
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
