import { t } from "../../shared/i18n";
import { Select } from "../../shared/Select";
import type {
  ConfigModel,
  ConfigProvider,
  ConfigStore,
  ProviderChannel,
} from "./configStore";
import type { SettingsWidgetsStore } from "./settingsWidgetsStore";

export function ConfigTab({
  store,
  widgets,
}: {
  store: ConfigStore;
  widgets: SettingsWidgetsStore;
}) {
  const sceneId = store((state) => state.sceneId);
  const sceneName = store((state) => state.sceneName);
  const configEditor = store((state) => state.configEditor);
  const modelsEditor = store((state) => state.modelsEditor);
  const authEnabled = widgets((state) => state.toggles.auth);
  return (
    <div className="settings-body">
      <div className="settings-scene-context configuration-scene-context">
        <span className="settings-scene-context-label">{t("Editing current scene")}</span>
        <strong id="configuration-scene-name">{sceneName}</strong>
        <code id="configuration-scene-id">{sceneId}</code>
        <span className="settings-scene-context-note">
          Credentials and model channels below belong only to this session scene.
        </span>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t("Authentication")}</div>
        <p className="settings-help">
          Keys are stored in the operating system credential vault. Scene configuration contains
          only non-sensitive references; secrets are never written to models.json or
          documentation.
        </p>
        <div className="settings-api-keys" id="settings-api-keys">
          <ApiKeysPanel store={store} />
        </div>
      </div>
      <div className="settings-section" id="settings-auth-section" style={{ display: "none" }}>
        <div className="settings-section-title">{t("Protection")}</div>
        <div className="settings-row">
          <span className="settings-label">{t("Require login")}</span>
          <button
            type="button"
            className={`settings-toggle${authEnabled ? " on" : ""}`}
            id="toggle-auth"
            role="switch"
            aria-checked={Boolean(authEnabled)}
            aria-label={t("Require login")}
            onClick={() => widgets.getState().toggle("auth")}
          ></button>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title settings-section-title-row">
          <span>{t("Custom model channels")}</span>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            id="provider-channel-add"
            onClick={() => void store.getState().openChannelEditor(null)}
          >
            {t("Add channel")}
          </button>
        </div>
        <p className="settings-help">
          {t(
            "Configure an OpenAI-, Anthropic-, or Google-compatible endpoint for this scene.",
          )}{" "}
          {t("Credentials are stored separately from {file}.").replace(
            "{file}",
            "models.json",
          )}
        </p>
        <div className="provider-channel-list" id="provider-channel-list">
          <ProviderChannelsPanel store={store} />
        </div>
        <ChannelEditorForm store={store} />
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t("Agent")}</div>
        <div className="settings-config-meta">
          <span className="settings-label">{t("Agent config file")}</span>
          <span className="settings-static-value" id="inline-config-path">
            {inlinePath(configEditor)}
          </span>
        </div>
        <InlineEditor store={store} kind="config" />
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t("Advanced provider JSON")}</div>
        <p className="settings-help">
          {t(
            "Edit {file} to add custom providers (Ollama, vLLM, LM Studio, OpenAI-compatible proxies, OpenRouter routing overrides, etc).",
          ).replace("{file}", "zicode/agent/models.json")}{" "}
          {t("See the")}{" "}
          <a
            href="https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/models.md"
            id="models-config-docs-link"
            onClick={(event) => {
              event.preventDefault();
              store.getState().openModelsDocs();
            }}
          >
            {t("models.json docs")}
          </a>{" "}
          {t("for the full schema. Changes are picked up immediately — no restart needed.")}
        </p>
        <div className="settings-config-meta">
          <span className="settings-label">{t("Providers file")}</span>
          <span className="settings-static-value" id="inline-models-path">
            {inlinePath(modelsEditor)}
          </span>
        </div>
        <InlineEditor store={store} kind="models" />
      </div>
    </div>
  );
}

function inlinePath(editor: { path: string; loading: boolean }): string {
  if (editor.loading) return t("Loading…");
  return editor.path;
}

function ApiKeysPanel({ store }: { store: ConfigStore }) {
  const status = store((state) => state.apiStatus);
  const error = store((state) => state.apiError);
  const providers = store((state) => state.providers);
  const search = store((state) => state.apiSearch);
  const revealAll = store((state) => state.revealAll);
  const setSearch = store((state) => state.setApiSearch);
  const setRevealAll = store((state) => state.setRevealAll);

  if (status === "loading") {
    return <div className="settings-api-keys-loading">{t("Loading providers…")}</div>;
  }
  if (status === "error") {
    return (
      <div className="settings-api-keys-empty">
        <div>{error || t("Failed to load providers.")}</div>
        <button
          type="button"
          className="ui-button ui-button--secondary config-editor-cancel"
          style={{ marginTop: "var(--space-2)" }}
          onClick={() => void store.getState().loadApiKeys()}
        >
          {t("Retry")}
        </button>
      </div>
    );
  }
  if (providers.length === 0) {
    return <div className="settings-api-keys-empty">{t("No providers known.")}</div>;
  }

  const sorted = [...providers].sort((a, b) => Number(b.configured) - Number(a.configured));
  const query = search.trim().toLocaleLowerCase();
  let visibleCount = 0;
  for (const provider of sorted) {
    const matchesQuery =
      !query ||
      `${provider.displayName || ""} ${provider.provider || ""}`
        .toLocaleLowerCase()
        .includes(query);
    if (matchesQuery && (revealAll || Boolean(query) || provider.configured)) visibleCount += 1;
  }

  return (
    <>
      <div className="settings-provider-filter">
        <input
          type="search"
          id="provider-auth-search"
          className="ui-input"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("Search providers…")}
          aria-label={t("Search providers")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          id="provider-auth-show-all"
          className="ui-button ui-button--secondary"
          onClick={() => setRevealAll(!revealAll)}
        >
          {revealAll ? t("Show configured only") : t("Show all providers")}
        </button>
      </div>
      <div
        className="settings-api-keys-empty"
        style={visibleCount > 0 ? { display: "none" } : undefined}
      >
        {t("No configured providers. Search or show all providers to add a key.")}
      </div>
      {sorted.map((provider) => (
        <ApiKeyRow key={provider.provider} store={store} provider={provider} />
      ))}
    </>
  );
}

function ApiKeyRow({ store, provider }: { store: ConfigStore; provider: ConfigProvider }) {
  const editingProvider = store((state) => state.editingProvider);
  const expanded = store((state) => state.expandedProviders[provider.provider] ?? true);
  const toggleExpanded = store((state) => state.toggleProviderExpanded);
  const models = Array.isArray(provider.models) ? provider.models : [];
  const hasConfiguredModels = provider.configured && models.length > 0;
  const editing = editingProvider?.provider === provider.provider;

  if (editing) return <ApiKeyEditor store={store} provider={provider} />;

  return (
    <div className="api-key-row" data-provider={provider.provider}>
      <div className="api-key-row-header">
        <button
          type="button"
          className="api-provider-toggle"
          aria-label={`Toggle ${provider.displayName || provider.provider} models`}
          aria-expanded={hasConfiguredModels ? expanded : false}
          style={hasConfiguredModels ? undefined : { visibility: "hidden" }}
          onClick={() => hasConfiguredModels && toggleExpanded(provider.provider)}
        >
          ▼
        </button>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: ARIA button pattern preserved from the vanilla API key row */}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is applied conditionally when models exist */}
        <div
          className="api-key-row-info"
          role={hasConfiguredModels ? "button" : undefined}
          tabIndex={hasConfiguredModels ? 0 : undefined}
          aria-label={hasConfiguredModels ? `Toggle ${provider.displayName || provider.provider} models` : undefined}
          onClick={(event) => {
            if (hasConfiguredModels && !(event.target as HTMLElement).closest?.(".api-key-row-actions")) {
              toggleExpanded(provider.provider);
            }
          }}
          onKeyDown={(event) => {
            if (hasConfiguredModels && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              toggleExpanded(provider.provider);
            }
          }}
        >
          <div className="api-key-row-name">{provider.displayName || provider.provider}</div>
        </div>
        {hasConfiguredModels ? (
          <div className="api-key-row-summary">{describeProviderSummary(models)}</div>
        ) : null}
        <div className="api-key-row-actions">
          {hasConfiguredModels ? (
            <button
              type="button"
              className="api-model-check-visible"
              disabled={!models.some((model) => model.available)}
              onClick={() => void store.getState().checkModelHealth(provider.provider)}
            >
              {t("Check health")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void store.getState().openApiKeyEditor(provider)}
          >
            {provider.configured ? t("Update") : t("Set key")}
          </button>
          {provider.configured && provider.source === "stored" ? (
            <button
              type="button"
              className="danger"
              onClick={() => void store.getState().removeApiKey(provider)}
            >
              {t("Remove")}
            </button>
          ) : null}
        </div>
      </div>
      {hasConfiguredModels ? (
        <ModelList store={store} provider={provider} models={models} expanded={expanded} />
      ) : null}
    </div>
  );
}

function ApiKeyEditor({ store, provider }: { store: ConfigStore; provider: ConfigProvider }) {
  const input = store((state) => state.apiKeyInput);
  const error = store((state) => state.apiKeyError);
  const saving = store((state) => state.apiKeySaving);
  const keyPrefix = store((state) => state.keyPrefix);
  const setInput = store((state) => state.setApiKeyInput);
  const close = store((state) => state.closeApiKeyEditor);
  const save = store((state) => state.saveApiKey);
  return (
    <form
      className="api-key-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="api-key-row-name">
        {provider.displayName || provider.provider} API key
      </div>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("Paste API key…")}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      />
      {keyPrefix ? (
        <span className="api-key-prefix-hint">
          {t("API key is configured (prefix {prefix})").replace("{prefix}", keyPrefix)}
        </span>
      ) : null}
      <div
        className="api-key-editor-error"
        style={{ display: error ? undefined : "none" }}
      >
        {error}
      </div>
      <div className="api-key-editor-actions">
        <button type="button" className="ui-button ui-button--secondary config-editor-cancel" onClick={close}>
          {t("Cancel")}
        </button>
        <button
          type="submit"
          className="ui-button ui-button--primary"
          disabled={saving}
        >
          {t("Save")}
        </button>
      </div>
    </form>
  );
}

function ModelList({
  store,
  provider,
  models,
  expanded,
}: {
  store: ConfigStore;
  provider: ConfigProvider;
  models: ConfigModel[];
  expanded: boolean;
}) {
  const visibilitySaving = store((state) => state.visibilitySaving);
  const allEnabled = models.every((model) => model.visible !== false);
  return (
    <div className={`api-model-list${expanded ? "" : " collapsed"}`}>
      <div className="api-model-list-heading">
        <span></span>
        <span>{t("Model")}</span>
        <div className="api-model-list-heading-actions"></div>
        <label className="api-model-select-all">
          <input
            type="checkbox"
            className="api-model-select-all-toggle"
            checked={allEnabled}
            disabled={visibilitySaving}
            aria-label={`${allEnabled ? "Deselect" : "Select"} all ${provider.displayName || provider.provider} models`}
            onChange={(event) =>
              void store.getState().setAllModelsVisibility(provider.provider, event.target.checked)
            }
          />
        </label>
      </div>
      {models.map((model) => (
        <ModelRow key={model.id} store={store} provider={provider.provider} model={model} />
      ))}
    </div>
  );
}

function ModelRow({
  store,
  provider,
  model,
}: {
  store: ConfigStore;
  provider: string;
  model: ConfigModel;
}) {
  const checkingModels = store((state) => state.checkingModels);
  const visibilitySaving = store((state) => state.visibilitySaving);
  const checking = checkingModels.includes(`${provider}::${model.id}`);
  const health = checking
    ? { status: "checking" as const }
    : model.health || { status: "unknown" as const };
  const statusText = checking
    ? t("Checking health...")
    : describeModelStatus(model);
  return (
    <div
      className="api-model-row"
      data-provider={provider}
      data-model-id={model.id}
      data-available={String(model.available)}
    >
      <span
        className={`api-model-health-dot ${health.status || "unknown"}`}
        title={checking ? t("Checking health") : describeModelHealth(health as { status?: string; latencyMs?: number; error?: string })}
      ></span>
      <div className="api-model-label">
        <div className="api-model-name">{model.name || model.id}</div>
        <div className="api-model-health-status">{statusText}</div>
      </div>
      <div className="api-model-actions">
        <label className="api-model-visibility">
          <input
            type="checkbox"
            className="api-model-visibility-toggle"
            aria-label={`Enable ${model.name || model.id}`}
            checked={model.visible !== false}
            disabled={visibilitySaving}
            onChange={(event) =>
              void store
                .getState()
                .setModelVisibility(provider, model.id, event.target.checked)
            }
          />
        </label>
      </div>
    </div>
  );
}

function ProviderChannelsPanel({ store }: { store: ConfigStore }) {
  const status = store((state) => state.channelStatus);
  const channels = store((state) => state.channels);
  const error = store((state) => state.channelError);
  if (status === "loading") {
    return <div>{t("Loading channels…")}</div>;
  }
  if (status === "error" && error) {
    return <div className="settings-api-keys-empty">{error}</div>;
  }
  if (channels.length === 0) {
    return <div className="settings-api-keys-empty">{t("No custom model channels in this scene.")}</div>;
  }
  return (
    <>
      {channels.map((channel) => (
        <ChannelRow key={channel.provider} store={store} channel={channel} />
      ))}
    </>
  );
}

function ChannelRow({ store, channel }: { store: ConfigStore; channel: ProviderChannel }) {
  return (
    <div className="provider-channel-row">
      <div>
        <strong>{channel.builtIn ? "QVeris Model Gateway" : channel.provider}</strong>
        <span>
          {channel.api} · {channel.baseUrl}
        </span>
      </div>
      <div>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => void store.getState().openChannelEditor(channel)}
        >
          {t("Edit")}
        </button>
        {channel.builtIn ? (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={channel.configured !== true}
            onClick={() => void store.getState().loadChannels()}
          >
            {t("Refresh models")}
          </button>
        ) : null}
        <button
          type="button"
          className="ui-button ui-button--secondary danger"
          style={channel.builtIn === true ? { display: "none" } : undefined}
          onClick={() => void store.getState().removeChannel(channel)}
        >
          {t("Remove")}
        </button>
      </div>
    </div>
  );
}

function ChannelEditorForm({ store }: { store: ConfigStore }) {
  const form = store((state) => state.channelEditor);
  const saving = store((state) => state.channelSaving);
  const error = store((state) => state.channelEditorError);
  const setForm = store((state) => state.setChannelForm);
  const close = store((state) => state.closeChannelEditor);
  const save = store((state) => state.saveChannel);
  if (!form) return null;
  return (
    <form
      className="provider-channel-editor"
      id="provider-channel-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input id="provider-channel-original-id" type="hidden" value={form.originalProvider} />
      <label>
        <span>{t("Channel ID")}</span>
        <input
          className="ui-input"
          id="provider-channel-id"
          required
          pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
          placeholder="team-proxy"
          value={form.provider}
          readOnly={false}
          onChange={(event) => setForm({ provider: event.target.value })}
        />
      </label>
      <label className="provider-channel-wide">
        <span>{t("Base URL")}</span>
        <input
          className="ui-input"
          id="provider-channel-base-url"
          required
          type="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://models.example.com/v1"
          value={form.baseUrl}
          onChange={(event) => setForm({ baseUrl: event.target.value })}
        />
      </label>
      <div className="config-field">
        <span>{t("API protocol")}</span>
        <Select
          id="provider-channel-api"
          value={form.api}
          label={t("API protocol")}
          options={[
            { value: "openai-completions", label: "OpenAI Chat Completions" },
            { value: "openai-responses", label: "OpenAI Responses" },
            { value: "anthropic-messages", label: "Anthropic Messages" },
            { value: "google-generative-ai", label: "Google Generative AI" },
          ]}
          onChange={(value) => setForm({ api: value })}
        />
      </div>
      <label>
        <span>{t("API key")}</span>
        <input
          className="ui-input"
          id="provider-channel-api-key"
          type="password"
          autoComplete="new-password"
          placeholder={t("Leave blank to keep current key")}
          value={form.apiKey}
          onChange={(event) => setForm({ apiKey: event.target.value })}
        />
        {form.keyPrefix ? (
          <span className="api-key-prefix-hint">
            {t("API key is configured (prefix {prefix})").replace("{prefix}", form.keyPrefix)}
          </span>
        ) : null}
      </label>
      <label className="provider-channel-wide">
        <span>{t("Models (one ID per line)")}</span>
        <textarea
          className="ui-textarea"
          id="provider-channel-models"
          required
          rows={4}
          placeholder={"gpt-5.2\ngpt-5.2-codex"}
          value={form.modelsText}
          onChange={(event) => setForm({ modelsText: event.target.value })}
        ></textarea>
      </label>
      <div
        className="settings-save-status provider-channel-wide"
        id="provider-channel-status"
        aria-live="polite"
        role="status"
        data-tone={error ? "error" : undefined}
      >
        {error || ""}
      </div>
      <div className="settings-config-actions provider-channel-wide">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          id="provider-channel-cancel"
          onClick={close}
        >
          {t("Cancel")}
        </button>
        <button
          type="submit"
          className="ui-button ui-button--primary"
          id="provider-channel-save"
          disabled={saving}
        >
          {saving ? t("Saving…") : t("Save channel")}
        </button>
      </div>
    </form>
  );
}

function InlineEditor({
  store,
  kind,
}: {
  store: ConfigStore;
  kind: "config" | "models";
}) {
  const editor = store((state) => (kind === "config" ? state.configEditor : state.modelsEditor));
  const textareaId = kind === "config" ? "inline-config-textarea" : "inline-models-textarea";
  const errorId = kind === "config" ? "inline-config-error" : "inline-models-error";
  const saveId = kind === "config" ? "inline-config-save" : "inline-models-save";
  const insertExample = store((state) => state.insertModelsExample);
  const saveAction = store((state) =>
    kind === "config" ? state.saveConfigEditor : state.saveModelsEditor,
  );
  return (
    <>
      <textarea
        className="ui-textarea config-editor-textarea settings-config-textarea"
        id={textareaId}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder={kind === "models" ? '{ "providers": { ... } }' : undefined}
        value={editor.content}
        onChange={(event) =>
          store.setState({
            ...(kind === "config"
              ? { configEditor: { ...editor, content: event.target.value, message: null } }
              : { modelsEditor: { ...editor, content: event.target.value, message: null } }),
          })
        }
      ></textarea>
      <div className="settings-config-actions">
        <div
          className={`config-editor-error settings-save-status${editor.message ? "" : " hidden"}`}
          id={errorId}
          aria-live="polite"
          role="status"
          data-tone={editor.message?.tone}
        >
          {editor.message?.message || ""}
        </div>
        <div className="settings-config-button-group">
          {kind === "models" ? (
            <button
              type="button"
              className="ui-button ui-button--secondary"
              id="inline-models-insert-example"
              onClick={() => insertExample()}
            >
              {t("Insert example")}
            </button>
          ) : null}
          <button
            type="button"
            className="ui-button ui-button--primary"
            id={saveId}
            disabled={editor.saving}
            onClick={() => void saveAction()}
          >
            {editor.saving ? t("Saving…") : t("Save")}
          </button>
        </div>
      </div>
    </>
  );
}

function describeProviderSummary(models: ConfigModel[]): string {
  // The summary reflects the usable set: models the user can pick. Hidden
  // catalog aliases (auto-hidden when the gateway rejects them) still show
  // their own per-row health, but no longer inflate the summary's issue count.
  const visible = models.filter((model) => model.visible !== false);
  const enabled = visible.length;
  const healthy = visible.filter((model) => model.health?.status === "healthy").length;
  const issues = visible.filter((model) => model.health?.status === "unhealthy").length;
  return `${enabled} ${t("enabled")} · ${healthy} ${t("healthy")} · ${issues} ${t("issues")}`;
}

function describeModelStatus(model: ConfigModel): string {
  const parts: string[] = [];
  if (!model.available) parts.push(t("No key available"));
  parts.push(describeModelHealth(model.health || { status: "unknown" }));
  return parts.join(" · ");
}

function describeModelHealth(health: {
  status?: string;
  latencyMs?: number;
  error?: string;
}): string {
  if (!health || health.status === "unknown") return t("Health unknown");
  if (health.status === "healthy") {
    return health.latencyMs ? `${t("Healthy")} (${health.latencyMs}ms)` : t("Healthy");
  }
  return health.error ? `${t("Failed")}: ${health.error}` : t("Failed");
}
