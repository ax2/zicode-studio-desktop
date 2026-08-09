// Configuration data plane for the native ZiCode Studio Desktop Settings → Configuration tab.
//
// The legacy `embedded-server.ts` served these operations over its own HTTP/WS
// server. In the native architecture there is no such server: the WebView talks
// to the Rust host, which forwards commands to pi over stdio RPC. pi's native
// RPC command set is fixed (see docs/rpc.md) and cannot be extended, so this
// module is invoked through a registered pi command (`/picot-config`) whose
// handler runs immediately without hitting the LLM or session history. Results
// are returned to the WebView via `ctx.ui.notify(JSON)`, correlated by request
// id (see public/native/config-gateway.js).
//
// All model-registry access (catalog, auth status, API keys, visibility,
// health) goes through the live `ctx.modelRegistry` — the same object the old
// embedded-server used — so we never re-implement pi's provider knowledge.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { runBacktest, type BacktestInput } from "./finance/backtest";
import { MarketDataStore, type MarketDataSnapshotInput } from "./finance/market-data";
import { normalizeOhlcv, type NormalizeOhlcvInput } from "./finance/normalize";
import { PaperTradingLedger } from "./finance/paper-trading";
import {
  QVerisClient,
  readQVerisApiKey,
  setQVerisRuntimeApiKey,
} from "./finance/qveris-client";
import { runScreening, type ScreeningInput } from "./finance/screener";
import {
  fetchQVerisModelCatalog,
  QVERIS_MODEL_GATEWAY_BASE_URL,
} from "./qveris-model-gateway";

type ModelHealthStatus = "unknown" | "healthy" | "unhealthy";

type ModelHealth = {
  status: ModelHealthStatus;
  checkedAt?: string;
  latencyMs?: number;
  error?: string;
};

type ModelPreferencesFile = {
  visibility?: Record<string, boolean>;
  health?: Record<string, ModelHealth>;
};

type CatalogModel = {
  provider?: string;
  id?: string;
  name?: string;
  contextWindow?: number;
};

type CatalogRegistry = {
  getAll: () => CatalogModel[];
  getAvailable: () => CatalogModel[] | Promise<CatalogModel[]>;
  getProviderAuthStatus: (provider: string) => {
    configured?: boolean;
    source?: string;
    label?: string;
  };
  getProviderDisplayName: (provider: string) => string;
  refresh: () => void | Promise<void>;
};

type ApiKeyCredential = { type: "api_key"; key: string };

const SUPPORTED_MODEL_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);
const QVERIS_PROVIDER_ID = "qveris";

type CredentialStoreLike = {
  modify?: (
    provider: string,
    fn: (current: unknown) => Promise<ApiKeyCredential | undefined>,
  ) => Promise<unknown>;
  delete?: (provider: string) => Promise<void>;
};

type RegistryInternals = {
  runtime?: { credentials?: CredentialStoreLike };
  authStorage?: {
    set?: (provider: string, value: ApiKeyCredential) => void | Promise<void>;
    remove?: (provider: string) => void | Promise<void>;
  };
};

export type PicotConfigResult = { ok: true; data?: unknown } | { ok: false; error: string };

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function resolvePiAgentRoot(): string {
  const isolatedRoot = process.env.PI_CODING_AGENT_DIR;
  if (typeof isolatedRoot === "string" && isolatedRoot.trim()) {
    return path.resolve(isolatedRoot.trim());
  }
  const desktopDataRoot = process.env.PI_DESKTOP_DATA_DIR;
  if (typeof desktopDataRoot === "string" && desktopDataRoot.trim()) {
    return path.join(path.resolve(desktopDataRoot.trim()), "agent");
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "zicode", "agent");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "zicode", "agent");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgDataHome, "zicode", "agent");
}

const PI_AGENT_ROOT = resolvePiAgentRoot();
const MODELS_PREFS_PATH = path.join(PI_AGENT_ROOT, "picot-models.json");
const AGENT_CONFIG_PATH = path.join(PI_AGENT_ROOT, "settings.json");
const MODELS_CONFIG_PATH = path.join(PI_AGENT_ROOT, "models.json");
const CHAT_CONFIG_PATH = path.join(PI_AGENT_ROOT, "chat", "config.json");
const AUTH_CONFIG_PATH = path.join(PI_AGENT_ROOT, "auth.json");
const SUPER_AGENT_TASKS_PATH = path.join(PI_AGENT_ROOT, "super-agent", "tasks.json");
const FINANCE_RESEARCH_PATH = path.join(PI_AGENT_ROOT, "finance", "research.json");
const AUTOMATION_WORKSPACE_PATH = path.join(PI_AGENT_ROOT, "automation", "workflows.json");
const PISTUDIO_INSTANCES_DIR = process.env.PI_DESKTOP_INSTANCE_DIR
  ? path.join(path.resolve(process.env.PI_DESKTOP_INSTANCE_DIR), "super-agent")
  : path.join(path.dirname(PI_AGENT_ROOT), "instances");

function modelPreferenceKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function normalizeModelHealth(value: unknown): ModelHealth {
  if (!value || typeof value !== "object") return { status: "unknown" };
  const candidate = value as Partial<ModelHealth>;
  if (candidate.status !== "healthy" && candidate.status !== "unhealthy") {
    return { status: "unknown" };
  }
  const health: ModelHealth = {
    status: candidate.status,
    checkedAt: typeof candidate.checkedAt === "string" ? candidate.checkedAt : undefined,
    latencyMs: typeof candidate.latencyMs === "number" ? candidate.latencyMs : undefined,
  };
  if (typeof candidate.error === "string") health.error = candidate.error;
  return health;
}

function sanitizeHealthError(error: unknown): string {
  const raw = errMessage(error) || "Health check failed";
  return raw
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[REDACTED]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "bearer [REDACTED]")
    .slice(0, 240);
}

class ModelPreferencesStore {
  readonly path: string;

  constructor(filePath = MODELS_PREFS_PATH) {
    this.path = filePath;
  }

  read(): Required<ModelPreferencesFile> {
    if (!fs.existsSync(this.path)) return { visibility: {}, health: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf8")) as ModelPreferencesFile;
      return {
        visibility:
          parsed.visibility &&
          typeof parsed.visibility === "object" &&
          !Array.isArray(parsed.visibility)
            ? parsed.visibility
            : {},
        health:
          parsed.health && typeof parsed.health === "object" && !Array.isArray(parsed.health)
            ? parsed.health
            : {},
      };
    } catch {
      return { visibility: {}, health: {} };
    }
  }

  write(next: Required<ModelPreferencesFile>): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(next, null, 2), "utf8");
  }

  isVisible(provider: string, modelId: string): boolean {
    return this.read().visibility[modelPreferenceKey(provider, modelId)] !== false;
  }

  setVisibility(provider: string, modelId: string, visible: boolean): void {
    const prefs = this.read();
    prefs.visibility[modelPreferenceKey(provider, modelId)] = visible;
    this.write(prefs);
  }

  getHealth(provider: string, modelId: string): ModelHealth {
    return normalizeModelHealth(this.read().health[modelPreferenceKey(provider, modelId)]);
  }

  setHealth(provider: string, modelId: string, health: ModelHealth): void {
    const prefs = this.read();
    prefs.health[modelPreferenceKey(provider, modelId)] = normalizeModelHealth(health);
    this.write(prefs);
  }
}

async function buildModelCatalog(registry: CatalogRegistry, preferences: ModelPreferencesStore) {
  const allModels = registry.getAll();
  const availableModels = await registry.getAvailable();
  const availableKeys = new Set(
    availableModels
      .filter((model) => model.provider && model.id)
      .map((model) => modelPreferenceKey(model.provider as string, model.id as string)),
  );
  const providerNames = Array.from(
    new Set([
      ...allModels.map((model) => model.provider).filter(Boolean),
      QVERIS_PROVIDER_ID,
    ]),
  ).sort() as string[];

  return {
    providers: providerNames.map((providerName) => {
      const status = registry.getProviderAuthStatus(providerName);
      const stored = hasStoredApiKey(providerName);
      return {
        provider: providerName,
        displayName:
          providerName === QVERIS_PROVIDER_ID
            ? "QVeris Model Gateway"
            : registry.getProviderDisplayName(providerName),
        configured: Boolean(status.configured) || stored,
        source: status.source || (stored ? "stored" : undefined),
        label: status.label,
        models: allModels
          .filter(
            (model) =>
              model.provider === providerName &&
              model.id &&
              availableKeys.has(modelPreferenceKey(providerName, model.id as string)),
          )
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .map((model) => {
            const modelId = model.id as string;
            return {
              provider: providerName,
              id: modelId,
              name: model.name,
              contextWindow: model.contextWindow,
              available: availableKeys.has(modelPreferenceKey(providerName, modelId)),
              visible: preferences.isVisible(providerName, modelId),
              health: preferences.getHealth(providerName, modelId),
            };
          }),
      };
    }),
  };
}

async function runModelHealthCheck(
  _registry: CatalogRegistry,
  model: CatalogModel,
  preferences: ModelPreferencesStore,
): Promise<{ provider: string; modelId: string } & ModelHealth> {
  const provider = model.provider as string;
  const modelId = model.id as string;
  const startedAt = Date.now();
  let sawAssistantText = false;
  try {
    // The QVeris credential lives in the desktop OS vault and is hydrated into
    // the running pi process by sealBrokerAuthConfig, not into a fresh model
    // session. Probe the same local model-gateway path the desktop chat uses
    // (baseUrl from this scene's models.json + the live runtime key) so the
    // health result reflects the real request path instead of a session that
    // never received the credential.
    if (provider === QVERIS_PROVIDER_ID) {
      const key = readQVerisApiKey();
      if (!key) throw new Error("QVeris API Key is not configured");
      const gatewayBase = qverisGatewayBaseUrl();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error("QVeris health check timed out")),
        30_000,
      );
      try {
        const response = await fetch(`${gatewayBase}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: modelId,
            stream: false,
            // Reasoning models spend their first tokens on thinking; leave
            // enough budget for the probe answer to be emitted.
            max_tokens: 128,
            messages: [{ role: "user", content: "Reply exactly: OK" }],
          }),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          throw new Error(
            `QVeris request failed (${response.status}): ${text.slice(0, 200)}`,
          );
        }
        sawAssistantText = /"content"\s*:\s*"[^"]*OK/i.test(text);
      } finally {
        clearTimeout(timer);
      }
      const result: { provider: string; modelId: string } & ModelHealth = {
        provider,
        modelId,
        status: sawAssistantText ? "healthy" : "unhealthy",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: sawAssistantText ? undefined : "No assistant text returned",
      };
      preferences.setHealth(provider, modelId, result);
      return result;
    }
    const modelRuntime = await ModelRuntime.create();
    const { session } = await createAgentSession({
      model,
      thinkingLevel: "off",
      tools: [],
      sessionManager: SessionManager.inMemory(),
      modelRuntime,
    } as Parameters<typeof createAgentSession>[0]);
    try {
      const unsubscribe = session.subscribe((event: unknown) => {
        const evt = event as { assistantMessageEvent?: { type?: string; delta?: string } };
        if (
          evt.assistantMessageEvent?.type === "text_delta" &&
          typeof evt.assistantMessageEvent.delta === "string" &&
          evt.assistantMessageEvent.delta.length > 0
        ) {
          sawAssistantText = true;
        }
      });
      try {
        await session.prompt("Reply exactly: OK");
      } finally {
        unsubscribe();
      }
    } finally {
      session.dispose();
    }
    const result: { provider: string; modelId: string } & ModelHealth = {
      provider,
      modelId,
      status: sawAssistantText ? "healthy" : "unhealthy",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error: sawAssistantText ? undefined : "No assistant text returned",
    };
    preferences.setHealth(provider, modelId, result);
    return result;
  } catch (e: unknown) {
    const result: { provider: string; modelId: string } & ModelHealth = {
      provider,
      modelId,
      status: "unhealthy",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error: sanitizeHealthError(e),
    };
    preferences.setHealth(provider, modelId, result);
    return result;
  }
}

function qverisGatewayBaseUrl(): string {
  try {
    const document = readModelsDocument();
    const baseUrl = document.providers?.[QVERIS_PROVIDER_ID]?.baseUrl;
    if (typeof baseUrl === "string" && baseUrl.trim()) {
      return baseUrl.trim().replace(/\/+$/, "");
    }
  } catch {
    // Fall through to the loopback default used by the bundled scene.
  }
  return "http://127.0.0.1:57620/v2/model-gateway";
}

function readConfigFile(filePath: string, fallback: string): { content: string; path: string } {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : fallback;
  return { content, path: filePath };
}

function writeConfigFile(filePath: string, content: unknown): void {
  if (typeof content !== "string") throw new Error("content must be a string");
  JSON.parse(content); // validate before writing
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readModelsDocument(): {
  providers: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
} {
  const parsed = fs.existsSync(MODELS_CONFIG_PATH)
    ? (JSON.parse(fs.readFileSync(MODELS_CONFIG_PATH, "utf8")) as Record<string, unknown>)
    : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("models.json must be a JSON object");
  }
  const providers =
    parsed.providers && typeof parsed.providers === "object" && !Array.isArray(parsed.providers)
      ? (parsed.providers as Record<string, Record<string, unknown>>)
      : {};
  const qveris = providers[QVERIS_PROVIDER_ID] || {};
  const qverisBaseUrl = asString(qveris.baseUrl) || QVERIS_MODEL_GATEWAY_BASE_URL;
  return {
    ...parsed,
    providers: {
      ...providers,
      [QVERIS_PROVIDER_ID]: {
        ...qveris,
        baseUrl: qverisBaseUrl,
        api: asString(qveris.api) || "openai-completions",
        authHeader: qveris.authHeader !== false,
        models: Array.isArray(qveris.models) ? qveris.models : [],
      },
    },
  };
}

function writeModelsDocument(document: Record<string, unknown>): void {
  writeConfigFile(MODELS_CONFIG_PATH, `${JSON.stringify(document, null, 2)}\n`);
}

function ensureBuiltInModelGateway(): void {
  const current = readModelsDocument();
  const stored = fs.existsSync(MODELS_CONFIG_PATH)
    ? (JSON.parse(fs.readFileSync(MODELS_CONFIG_PATH, "utf8")) as {
        providers?: Record<string, { baseUrl?: unknown }>;
      })
    : {};
  if (asString(stored.providers?.[QVERIS_PROVIDER_ID]?.baseUrl)) {
    return;
  }
  writeModelsDocument(current);
}

async function syncQVerisModelCatalog(
  registry?: CatalogRegistry,
  apiKey = readQVerisApiKey(),
): Promise<{ count: number; refreshed: boolean }> {
  if (!apiKey) throw new Error("QVeris API Key is not configured for this scene");
  const document = readModelsDocument();
  const current = document.providers[QVERIS_PROVIDER_ID] || {};
  const baseUrl = validateBaseUrl(current.baseUrl || QVERIS_MODEL_GATEWAY_BASE_URL);
  const models = await fetchQVerisModelCatalog(apiKey, { baseUrl });
  document.providers[QVERIS_PROVIDER_ID] = {
    ...current,
    baseUrl,
    api: "openai-completions",
    authHeader: true,
    models,
  };
  writeModelsDocument(document);
  return { count: models.length, refreshed: await refreshRegistry(registry) };
}

function hasStoredApiKey(provider: string): boolean {
  const credential = readAuthConfig()[provider];
  if (typeof credential === "string") return Boolean(credential.trim());
  if (!credential || typeof credential !== "object" || Array.isArray(credential)) return false;
  return Boolean(asString((credential as { key?: unknown }).key));
}

function validateBaseUrl(value: unknown): string {
  const baseUrl = asString(value);
  if (!baseUrl) throw new Error("baseUrl is required");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("baseUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("baseUrl must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("baseUrl must not contain credentials");
  }
  return baseUrl.replace(/\/+$/, "");
}

function validateProviderId(value: unknown): string {
  const provider = asString(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(provider)) {
    throw new Error("provider must be 1-64 letters, digits, dots, underscores, or hyphens");
  }
  return provider;
}

function normalizeChannelModels(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("at least one model is required");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("each model must be an object");
    }
    const model = entry as Record<string, unknown>;
    const id = asString(model.id);
    if (!id) throw new Error("each model requires an id");
    if (seen.has(id)) throw new Error(`duplicate model id: ${id}`);
    seen.add(id);
    const normalized: Record<string, unknown> = { id };
    const name = asString(model.name);
    if (name) normalized.name = name;
    if (typeof model.reasoning === "boolean") normalized.reasoning = model.reasoning;
    const contextWindow = asNumber(model.contextWindow);
    if (contextWindow && contextWindow > 0) normalized.contextWindow = Math.trunc(contextWindow);
    const maxTokens = asNumber(model.maxTokens);
    if (maxTokens && maxTokens > 0) normalized.maxTokens = Math.trunc(maxTokens);
    return normalized;
  });
}

async function refreshRegistry(registry?: CatalogRegistry): Promise<boolean> {
  if (!registry) return false;
  try {
    await registry.refresh();
    return true;
  } catch {
    return false;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireFinanceScene(capability: string): void {
  if (process.env.PI_DESKTOP_SCENE_ID !== "finance") {
    throw new Error(`Finance ${capability} is only available in a Finance scene`);
  }
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

type SuperAgentProject = { name: string; cwd: string; status: string };

// The Runtime panel's project picker lists dispatch targets. In the native
// architecture the old `/api/super-agent/projects` HTTP endpoint no longer
// exists, so we reconstruct the list from the per-process instance records
// ZiCode Studio Desktop writes instance records below its private data root (each has a `cwd`). The
// super-agent workspace itself is never a dispatch target.
function listSuperAgentProjects(): SuperAgentProject[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(PISTUDIO_INSTANCES_DIR);
  } catch {
    return [];
  }
  const byCwd = new Map<string, SuperAgentProject>();
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const record = readJsonFile(path.join(PISTUDIO_INSTANCES_DIR, entry)) as
      | { cwd?: unknown }
      | undefined;
    const cwd = typeof record?.cwd === "string" ? record.cwd.replace(/\/+$/, "") : "";
    if (!cwd || cwd.endsWith("/zicode/workspaces/agent-inbox")) continue;
    byCwd.set(cwd, { name: cwd.split("/").pop() || cwd, cwd, status: "running" });
  }
  return [...byCwd.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readAuthConfig(): Record<string, unknown> {
  if (!fs.existsSync(AUTH_CONFIG_PATH)) return {};
  const parsed = JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function writeAuthConfig(auth: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(AUTH_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(auth, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(AUTH_CONFIG_PATH, 0o600);
  } catch {
    // chmod is best-effort on platforms/filesystems that do not support POSIX modes.
  }
}

export async function sealBrokerAuthConfig(
  registry?: CatalogRegistry,
): Promise<void> {
  if (process.env.PI_DESKTOP_CREDENTIAL_BROKER !== "system" || !fs.existsSync(AUTH_CONFIG_PATH)) {
    return;
  }
  const internals = registry as (CatalogRegistry & RegistryInternals) | undefined;
  const auth = readAuthConfig();
  const qveris = auth[QVERIS_PROVIDER_ID];
  const qverisKey =
    typeof qveris === "string"
      ? qveris.trim()
      : qveris && typeof qveris === "object" && !Array.isArray(qveris)
        ? asString((qveris as { key?: unknown }).key)
        : "";
  if (qverisKey) setQVerisRuntimeApiKey(qverisKey);
  // Keep the runtime able to resolve provider auth after the plaintext file is
  // removed: mirror every provider credential into the live credential store
  // when one exists. If no live store is available, leave the broker
  // materialized file in place so availability and requests keep working.
  let hydrated = false;
  for (const [provider, credential] of Object.entries(auth)) {
    const key =
      typeof credential === "string"
        ? credential.trim()
        : credential && typeof credential === "object" && !Array.isArray(credential)
          ? asString((credential as { key?: unknown }).key).trim()
          : "";
    if (!key) continue;
    if (internals?.authStorage?.set) {
      await internals.authStorage.set(provider, { type: "api_key", key });
      hydrated = true;
    } else if (internals?.runtime?.credentials?.modify) {
      await internals.runtime.credentials.modify(provider, async () => ({
        type: "api_key",
        key,
      }));
      hydrated = true;
    }
  }
  if (!hydrated) return;
  fs.rmSync(AUTH_CONFIG_PATH, { force: true });
}

async function setStoredApiKey(
  registry: CatalogRegistry | undefined,
  provider: string,
  apiKey: string,
): Promise<void> {
  const internals = registry as (CatalogRegistry & RegistryInternals) | undefined;
  const credentials = internals?.runtime?.credentials;
  if (credentials?.modify) {
    await credentials.modify(provider, async () => ({ type: "api_key", key: apiKey }));
    return;
  }
  if (internals?.authStorage?.set) {
    await internals.authStorage.set(provider, { type: "api_key", key: apiKey });
    return;
  }
  const auth = readAuthConfig();
  auth[provider] = { type: "api_key", key: apiKey };
  writeAuthConfig(auth);
}

async function removeStoredApiKey(
  registry: CatalogRegistry | undefined,
  provider: string,
): Promise<void> {
  const internals = registry as (CatalogRegistry & RegistryInternals) | undefined;
  const credentials = internals?.runtime?.credentials;
  if (credentials?.delete) {
    await credentials.delete(provider);
    return;
  }
  if (internals?.authStorage?.remove) {
    await internals.authStorage.remove(provider);
    return;
  }
  if (!fs.existsSync(AUTH_CONFIG_PATH)) return;
  const auth = readAuthConfig();
  delete auth[provider];
  writeAuthConfig(auth);
}

// Dispatch a single Configuration operation. `ctx` is the extension command
// context; `ctx.modelRegistry` provides live provider/model/auth access.
export async function handlePicotConfig(
  op: string,
  params: Record<string, unknown>,
  ctx: { modelRegistry?: CatalogRegistry; cwd?: string },
): Promise<PicotConfigResult> {
  const registry = ctx.modelRegistry;
  const preferences = new ModelPreferencesStore();

  const requireRegistry = (): CatalogRegistry => {
    if (!registry) throw new Error("Model registry not ready yet — try again in a moment.");
    return registry;
  };

  try {
    ensureBuiltInModelGateway();
    // The Rust broker materializes auth.json only long enough for Pi to load
    // its live registry. Commands are available after that initialization.
    await sealBrokerAuthConfig(registry);
    switch (op) {
      case "list_model_catalog": {
        const catalog = await buildModelCatalog(requireRegistry(), preferences);
        return { ok: true, data: catalog };
      }

      case "set_model_visibility": {
        const provider = asString(params.provider);
        const modelId = asString(params.modelId);
        if (!provider || !modelId) throw new Error("provider and modelId are required");
        const visible = params.visible !== false;
        preferences.setVisibility(provider, modelId, visible);
        return { ok: true, data: { provider, modelId, visible } };
      }

      case "check_model_health": {
        const reg = requireRegistry();
        const provider = asString(params.provider);
        const modelId = asString(params.modelId);
        if (!provider) throw new Error("provider is required");
        const availableKeys = new Set(
          (await reg.getAvailable())
            .filter((model) => model.provider && model.id)
            .map((model) => modelPreferenceKey(model.provider as string, model.id as string)),
        );
        const models = reg.getAll().filter((model) => {
          if (model.provider !== provider || !model.id) return false;
          if (modelId) return model.id === modelId;
          return availableKeys.has(modelPreferenceKey(provider, model.id as string));
        });
        if (models.length === 0) throw new Error("No matching models available for health check");
        const results = [];
        // Probe with bounded concurrency so a 25-model channel finishes in a
        // few seconds instead of running sequentially past the UI timeout.
        const CONCURRENCY = 5;
        let nextIndex = 0;
        const workers = Array.from({ length: Math.min(CONCURRENCY, models.length) }, async () => {
          while (nextIndex < models.length) {
            const model = models[nextIndex];
            nextIndex += 1;
            results.push(await runModelHealthCheck(reg, model, preferences));
          }
        });
        await Promise.all(workers);
        return { ok: true, data: { results } };
      }

      case "set_api_key": {
        const provider = asString(params.provider);
        const apiKey = asString(params.apiKey);
        if (!provider) throw new Error("provider is required");
        if (!apiKey) throw new Error("apiKey is required");
        await setStoredApiKey(registry, provider, apiKey);
        if (provider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(apiKey);
        if (provider === QVERIS_PROVIDER_ID) {
          const modelSync = await syncQVerisModelCatalog(registry, apiKey);
          await sealBrokerAuthConfig(registry);
          return { ok: true, data: { provider, modelSync } };
        }
        if (registry) await registry.refresh();
        await sealBrokerAuthConfig(registry);
        return { ok: true, data: { provider } };
      }

      case "remove_api_key": {
        const provider = asString(params.provider);
        if (!provider) throw new Error("provider is required");
        await removeStoredApiKey(registry, provider);
        if (provider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(null);
        if (registry) await registry.refresh();
        await sealBrokerAuthConfig(registry);
        return { ok: true, data: { provider } };
      }

      case "list_provider_channels": {
        const document = readModelsDocument();
        const channels = Object.entries(document.providers).map(([provider, config]) => ({
          provider,
          baseUrl: asString(config.baseUrl),
          api: asString(config.api) || "openai-completions",
          authHeader: config.authHeader !== false,
          models: Array.isArray(config.models) ? config.models : [],
          builtIn: provider === QVERIS_PROVIDER_ID,
          configured:
            registry?.getProviderAuthStatus(provider)?.configured === true ||
            hasStoredApiKey(provider),
        }));
        return { ok: true, data: { channels } };
      }

      case "sync_qveris_models": {
        const modelSync = await syncQVerisModelCatalog(registry);
        return { ok: true, data: { provider: QVERIS_PROVIDER_ID, modelSync } };
      }

      case "save_provider_channel": {
        const provider = validateProviderId(params.provider);
        const originalProvider = params.originalProvider
          ? validateProviderId(params.originalProvider)
          : provider;
        const baseUrl = validateBaseUrl(params.baseUrl);
        const api = asString(params.api) || "openai-completions";
        if (!SUPPORTED_MODEL_APIS.has(api)) throw new Error(`unsupported API type: ${api}`);
        const builtInQVeris = originalProvider === QVERIS_PROVIDER_ID;
        if (builtInQVeris && provider !== QVERIS_PROVIDER_ID) {
          throw new Error("QVeris Model Gateway provider ID cannot be changed");
        }
        const document = readModelsDocument();
        const existing = document.providers[originalProvider] || {};
        const models =
          builtInQVeris && Array.isArray(params.models) && params.models.length === 0
            ? Array.isArray(existing.models)
              ? existing.models
              : []
            : normalizeChannelModels(params.models);
        if (originalProvider !== provider) delete document.providers[originalProvider];
        document.providers[provider] = {
          baseUrl,
          api,
          authHeader: params.authHeader !== false,
          models,
        };
        writeModelsDocument(document);
        const apiKey = asString(params.apiKey);
        if (apiKey) {
          await setStoredApiKey(registry, provider, apiKey);
          if (provider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(apiKey);
        }
        if (originalProvider !== provider) await removeStoredApiKey(registry, originalProvider);
        if (builtInQVeris && (apiKey || readQVerisApiKey())) {
          const modelSync = await syncQVerisModelCatalog(registry, apiKey || readQVerisApiKey());
          await sealBrokerAuthConfig(registry);
          return { ok: true, data: { provider, refreshed: modelSync.refreshed, modelSync } };
        }
        const refreshed = await refreshRegistry(registry);
        await sealBrokerAuthConfig(registry);
        return { ok: true, data: { provider, refreshed } };
      }

      case "remove_provider_channel": {
        const provider = validateProviderId(params.provider);
        if (provider === QVERIS_PROVIDER_ID) {
          throw new Error("QVeris Model Gateway is built in and cannot be removed");
        }
        const document = readModelsDocument();
        delete document.providers[provider];
        writeModelsDocument(document);
        await removeStoredApiKey(registry, provider);
        const refreshed = await refreshRegistry(registry);
        await sealBrokerAuthConfig(registry);
        return { ok: true, data: { provider, refreshed } };
      }

      case "finance_status": {
        const qveris = new QVerisClient().credentialStatus();
        return {
          ok: true,
          data: {
            sceneId: process.env.PI_DESKTOP_SCENE_ID || "programming",
            qveris: { configured: qveris.configured },
            tools: [
              "qveris_discover",
              "qveris_inspect",
              "qveris_call",
              "qveris_usage",
              "finance_backtest",
              "finance_normalize_ohlcv",
              "finance_screen",
              "finance_market_data",
              "finance_paper_account",
              "finance_paper_order",
              "finance_paper_limit_order",
            ],
          },
        };
      }

      case "finance_discover": {
        if (process.env.PI_DESKTOP_SCENE_ID !== "finance") {
          throw new Error("Finance data discovery is only available in a Finance scene");
        }
        const query = asString(params.query);
        if (!query) throw new Error("query is required");
        const limit = Math.max(1, Math.min(10, Math.trunc(asNumber(params.limit) ?? 8)));
        const data = await new QVerisClient().discover({ query, limit, lang: "zh" });
        return { ok: true, data };
      }

      case "finance_qveris_usage": {
        requireFinanceScene("QVeris billing audit");
        const client = new QVerisClient();
        const limit = Math.max(1, Math.min(50, Math.trunc(asNumber(params.limit) ?? 10)));
        const [usage, ledger] = await Promise.all([
          client.usageAudit({ summary: true, limit }),
          client.creditsLedger({ summary: true, limit }),
        ]);
        return { ok: true, data: { usage, ledger } };
      }

      case "finance_backtest": {
        if (process.env.PI_DESKTOP_SCENE_ID !== "finance") {
          throw new Error("Finance backtesting is only available in a Finance scene");
        }
        if (!params.input || typeof params.input !== "object" || Array.isArray(params.input)) {
          throw new Error("input must be a backtest object");
        }
        return { ok: true, data: runBacktest(params.input as BacktestInput) };
      }

      case "finance_normalize_ohlcv": {
        requireFinanceScene("OHLCV normalization");
        if (!params.input || typeof params.input !== "object" || Array.isArray(params.input)) {
          throw new Error("input must be an OHLCV normalization object");
        }
        return { ok: true, data: normalizeOhlcv(params.input as NormalizeOhlcvInput) };
      }

      case "finance_screen": {
        requireFinanceScene("screening");
        if (!params.input || typeof params.input !== "object" || Array.isArray(params.input)) {
          throw new Error("input must be a screening object");
        }
        return { ok: true, data: runScreening(params.input as ScreeningInput) };
      }

      case "finance_market_data": {
        requireFinanceScene("market data snapshots");
        const store = new MarketDataStore();
        const action = asString(params.action);
        if (action === "save") {
          if (!params.snapshot || typeof params.snapshot !== "object") {
            throw new Error("snapshot is required");
          }
          return { ok: true, data: store.save(params.snapshot as MarketDataSnapshotInput) };
        }
        if (action === "latest") {
          return {
            ok: true,
            data: store.latest({
              kind: asString(params.kind) as MarketDataSnapshotInput["kind"],
              symbol: asString(params.symbol) || undefined,
              market: asString(params.market) || undefined,
            }),
          };
        }
        if (action === "list") {
          return {
            ok: true,
            data: {
              snapshots: store.list({
                kind:
                  (asString(params.kind) as MarketDataSnapshotInput["kind"]) || undefined,
                symbol: asString(params.symbol) || undefined,
                market: asString(params.market) || undefined,
                limit: asNumber(params.limit),
              }),
            },
          };
        }
        throw new Error("unsupported market data action");
      }

      case "finance_paper_accounts": {
        requireFinanceScene("paper trading");
        const ledger = new PaperTradingLedger();
        const action = asString(params.action) || "list";
        if (action === "list") return { ok: true, data: { accounts: ledger.listAccounts() } };
        if (action === "get") {
          return { ok: true, data: ledger.getAccount(asString(params.accountId)) };
        }
        if (action === "mark") {
          if (!Array.isArray(params.quotes)) throw new Error("quotes must be an array");
          return {
            ok: true,
            data: ledger.markToMarket({
              accountId: asString(params.accountId),
              quotes: params.quotes as Parameters<PaperTradingLedger["markToMarket"]>[0]["quotes"],
              maxAgeMinutes: asNumber(params.maxAgeMinutes),
            }),
          };
        }
        if (action === "create") {
          return {
            ok: true,
            data: ledger.createAccount({
              name: asString(params.name),
              baseCurrency: asString(params.baseCurrency) || undefined,
              initialCash: asNumber(params.initialCash),
            }),
          };
        }
        throw new Error("unsupported paper account action");
      }

      case "finance_paper_order": {
        requireFinanceScene("paper trading");
        if (!params.input || typeof params.input !== "object" || Array.isArray(params.input)) {
          throw new Error("input must be a paper order object");
        }
        return {
          ok: true,
          data: new PaperTradingLedger().executeMarketOrder(
            params.input as Parameters<PaperTradingLedger["executeMarketOrder"]>[0],
          ),
        };
      }

      case "finance_paper_limit_order": {
        requireFinanceScene("paper limit orders");
        const ledger = new PaperTradingLedger();
        const action = asString(params.action);
        if (action === "place") {
          return {
            ok: true,
            data: ledger.placeLimitOrder({
              accountId: asString(params.accountId),
              symbol: asString(params.symbol),
              side: asString(params.side) as "buy" | "sell",
              quantity: asNumber(params.quantity) as number,
              limitPrice: asNumber(params.limitPrice) as number,
              feeBps: asNumber(params.feeBps),
              currency: asString(params.currency) || undefined,
            }),
          };
        }
        if (action === "cancel") {
          return {
            ok: true,
            data: ledger.cancelOrder({
              accountId: asString(params.accountId),
              orderId: asString(params.orderId),
            }),
          };
        }
        if (action === "process") {
          if (!Array.isArray(params.quotes)) throw new Error("quotes must be an array");
          return {
            ok: true,
            data: ledger.processLimitOrders({
              accountId: asString(params.accountId),
              quotes:
                params.quotes as Parameters<PaperTradingLedger["processLimitOrders"]>[0]["quotes"],
            }),
          };
        }
        throw new Error("unsupported paper limit-order action");
      }

      case "finance_research_workspace": {
        requireFinanceScene("research workspace");
        const action = asString(params.action) || "list";
        const workspace = readFinanceResearchWorkspace();
        if (action === "list") return { ok: true, data: workspace };
        if (action === "upsert") {
          const card = normalizeFinanceResearchCard(params.card);
          const index = workspace.cards.findIndex((item) => item.id === card.id);
          if (index >= 0) workspace.cards[index] = card;
          else workspace.cards.unshift(card);
          workspace.cards = workspace.cards.slice(0, 500);
          writeFinanceResearchWorkspace(workspace);
          return { ok: true, data: { card, workspace } };
        }
        if (action === "remove") {
          const id = asString(params.id);
          workspace.cards = workspace.cards.filter((item) => item.id !== id);
          writeFinanceResearchWorkspace(workspace);
          return { ok: true, data: workspace };
        }
        throw new Error("unsupported finance research action");
      }

      case "automation_workspace": {
        const action = asString(params.action) || "list";
        const workspace = readAutomationWorkspace();
        if (action === "list") return { ok: true, data: workspace };
        if (action === "upsert") {
          const workflow = normalizeAutomationWorkflow(params.workflow);
          const index = workspace.workflows.findIndex((item) => item.id === workflow.id);
          if (index >= 0) workspace.workflows[index] = workflow;
          else workspace.workflows.unshift(workflow);
          workspace.workflows = workspace.workflows.slice(0, 200);
          writeAutomationWorkspace(workspace);
          return { ok: true, data: { workflow, workspace } };
        }
        if (action === "remove") {
          const id = asString(params.id);
          workspace.workflows = workspace.workflows.filter((item) => item.id !== id);
          writeAutomationWorkspace(workspace);
          return { ok: true, data: workspace };
        }
        if (action === "record_run") {
          const id = asString(params.id);
          const index = workspace.workflows.findIndex((item) => item.id === id);
          if (index < 0) throw new Error("automation workflow was not found");
          const current = workspace.workflows[index];
          const run = normalizeAutomationRun(params.run);
          current.history = [run, ...current.history].slice(0, 100);
          current.lastRunAt = run.startedAt;
          current.nextRunAt = asString(params.nextRunAt) || null;
          current.approvalPending = params.approvalPending === true;
          current.updatedAt = new Date().toISOString();
          writeAutomationWorkspace(workspace);
          return { ok: true, data: { workflow: current, workspace } };
        }
        throw new Error("unsupported automation action");
      }

      case "read_agent_config":
        return { ok: true, data: readConfigFile(AGENT_CONFIG_PATH, "{}") };

      case "write_agent_config": {
        writeConfigFile(AGENT_CONFIG_PATH, params.content);
        return { ok: true, data: { path: AGENT_CONFIG_PATH } };
      }

      case "read_models_config":
        return { ok: true, data: readConfigFile(MODELS_CONFIG_PATH, '{\n  "providers": {}\n}\n') };

      case "write_models_config": {
        const content = params.content;
        if (typeof content !== "string") throw new Error("content must be a string");
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("models.json must be a JSON object");
        }
        if (
          "providers" in parsed &&
          (typeof parsed.providers !== "object" || Array.isArray(parsed.providers))
        ) {
          throw new Error("'providers' must be an object");
        }
        writeConfigFile(MODELS_CONFIG_PATH, content);
        const refreshed = await refreshRegistry(registry);
        return { ok: true, data: { path: MODELS_CONFIG_PATH, refreshed } };
      }

      case "read_chat_config":
        return { ok: true, data: readConfigFile(CHAT_CONFIG_PATH, "{}") };

      case "write_chat_config": {
        writeConfigFile(CHAT_CONFIG_PATH, params.content);
        return { ok: true, data: { path: CHAT_CONFIG_PATH } };
      }

      case "read_project_profile": {
        const profilePath = projectProfilePath(ctx.cwd);
        const profile = readProjectProfile(profilePath);
        return { ok: true, data: { profile, path: profilePath } };
      }

      case "write_project_profile": {
        const profilePath = projectProfilePath(ctx.cwd);
        const profile = normalizeProjectProfile(params.profile);
        writeConfigFile(profilePath, JSON.stringify(profile, null, 2));
        return { ok: true, data: { profile, path: profilePath } };
      }

      case "read_super_agent_tasks": {
        const content = fs.existsSync(SUPER_AGENT_TASKS_PATH)
          ? fs.readFileSync(SUPER_AGENT_TASKS_PATH, "utf8")
          : '{"tasks":[]}';
        let tasks: unknown[] = [];
        try {
          const parsed = JSON.parse(content) as { tasks?: unknown[] };
          tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
        } catch {
          tasks = [];
        }
        return { ok: true, data: { tasks } };
      }

      case "write_super_agent_tasks": {
        const tasks = Array.isArray(params.tasks) ? params.tasks : [];
        fs.mkdirSync(path.dirname(SUPER_AGENT_TASKS_PATH), { recursive: true });
        fs.writeFileSync(SUPER_AGENT_TASKS_PATH, JSON.stringify({ tasks }, null, 2), "utf8");
        return { ok: true, data: { count: tasks.length } };
      }

      case "list_super_agent_projects": {
        return { ok: true, data: { projects: listSuperAgentProjects() } };
      }

      case "open_external": {
        const url = asString(params.url);
        if (!url) throw new Error("url is required");
        openExternal(url);
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown configuration operation: ${op}` };
    }
  } catch (e: unknown) {
    return { ok: false, error: errMessage(e) };
  }
}

type ProjectProfile = {
  version: 1;
  instructions: string;
  defaultScene: string;
  budget: number | null;
  updatedAt: string | null;
};

type FinanceResearchCard = {
  id: string;
  symbol: string;
  title: string;
  thesis: string;
  bullCase: string;
  bearCase: string;
  invalidation: string;
  sources: string[];
  eventAt: string | null;
  updatedAt: string;
};

type FinanceResearchWorkspace = { version: 1; cards: FinanceResearchCard[] };

type AutomationRun = {
  id: string;
  status: string;
  startedAt: string;
  taskId: string | null;
  message: string;
};

type AutomationWorkflow = {
  id: string;
  title: string;
  prompt: string;
  targetProject: string;
  enabled: boolean;
  schedule: "manual" | "interval" | "daily";
  intervalMinutes: number | null;
  dailyTime: string | null;
  requireApproval: boolean;
  maxCost: number | null;
  maxRetries: number;
  approvalPending: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  updatedAt: string;
  history: AutomationRun[];
};

type AutomationWorkspace = { version: 1; workflows: AutomationWorkflow[] };

function readAutomationWorkspace(): AutomationWorkspace {
  if (!fs.existsSync(AUTOMATION_WORKSPACE_PATH)) return { version: 1, workflows: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTOMATION_WORKSPACE_PATH, "utf8")) as {
      workflows?: unknown[];
    };
    return {
      version: 1,
      workflows: Array.isArray(parsed.workflows)
        ? parsed.workflows.map((workflow) => normalizeAutomationWorkflow(workflow)).slice(0, 200)
        : [],
    };
  } catch {
    return { version: 1, workflows: [] };
  }
}

function writeAutomationWorkspace(workspace: AutomationWorkspace): void {
  writeConfigFile(AUTOMATION_WORKSPACE_PATH, JSON.stringify(workspace, null, 2));
}

function normalizeAutomationRun(value: unknown): AutomationRun {
  const run = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    id: asString(run.id) || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: asString(run.status) || "queued",
    startedAt: asString(run.startedAt) || new Date().toISOString(),
    taskId: asString(run.taskId) || null,
    message: asString(run.message).slice(0, 2_000),
  };
}

function normalizeAutomationWorkflow(value: unknown): AutomationWorkflow {
  const workflow = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const scheduleValue = asString(workflow.schedule);
  const schedule = scheduleValue === "interval" || scheduleValue === "daily" ? scheduleValue : "manual";
  const interval = Number(workflow.intervalMinutes);
  const history = Array.isArray(workflow.history)
    ? workflow.history.map((run) => normalizeAutomationRun(run)).slice(0, 100)
    : [];
  return {
    id: asString(workflow.id) || `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: asString(workflow.title).trim().slice(0, 200) || "Untitled automation",
    prompt: asString(workflow.prompt).trim().slice(0, 50_000),
    targetProject: asString(workflow.targetProject).trim().slice(0, 2_000),
    enabled: workflow.enabled !== false,
    schedule,
    intervalMinutes:
      schedule === "interval" && Number.isFinite(interval) ? Math.min(10_080, Math.max(5, interval)) : null,
    dailyTime: schedule === "daily" ? asString(workflow.dailyTime).slice(0, 5) || "09:00" : null,
    requireApproval: workflow.requireApproval !== false,
    maxCost:
      Number.isFinite(Number(workflow.maxCost)) && Number(workflow.maxCost) > 0
        ? Math.min(10_000, Number(workflow.maxCost))
        : null,
    maxRetries: Number.isFinite(Number(workflow.maxRetries))
      ? Math.min(10, Math.max(0, Math.floor(Number(workflow.maxRetries))))
      : 2,
    approvalPending: workflow.approvalPending === true,
    lastRunAt: asString(workflow.lastRunAt) || null,
    nextRunAt: asString(workflow.nextRunAt) || null,
    updatedAt: asString(workflow.updatedAt) || new Date().toISOString(),
    history,
  };
}

function readFinanceResearchWorkspace(): FinanceResearchWorkspace {
  if (!fs.existsSync(FINANCE_RESEARCH_PATH)) return { version: 1, cards: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(FINANCE_RESEARCH_PATH, "utf8")) as { cards?: unknown[] };
    return {
      version: 1,
      cards: Array.isArray(parsed.cards)
        ? parsed.cards
            .map((card) => {
              const normalized = normalizeFinanceResearchCard(card);
              const saved = card && typeof card === "object" ? (card as Record<string, unknown>) : {};
              normalized.updatedAt = asString(saved.updatedAt) || normalized.updatedAt;
              return normalized;
            })
            .slice(0, 500)
        : [],
    };
  } catch {
    return { version: 1, cards: [] };
  }
}

function writeFinanceResearchWorkspace(workspace: FinanceResearchWorkspace): void {
  writeConfigFile(FINANCE_RESEARCH_PATH, JSON.stringify(workspace, null, 2));
}

function normalizeFinanceResearchCard(value: unknown): FinanceResearchCard {
  const card = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const symbol = asString(card.symbol).trim().toUpperCase().slice(0, 32);
  if (!symbol) throw new Error("research card symbol is required");
  const sourceValues = Array.isArray(card.sources)
    ? card.sources
    : asString(card.sources).split(/\r?\n|,/);
  const sources = sourceValues
    .map((source) => asString(source).trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((source) => source.slice(0, 500));
  const eventAtValue = asString(card.eventAt).trim();
  return {
    id: asString(card.id) || `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    title: (asString(card.title).trim() || symbol).slice(0, 200),
    thesis: asString(card.thesis).trim().slice(0, 20_000),
    bullCase: asString(card.bullCase).trim().slice(0, 20_000),
    bearCase: asString(card.bearCase).trim().slice(0, 20_000),
    invalidation: asString(card.invalidation).trim().slice(0, 20_000),
    sources,
    eventAt: eventAtValue || null,
    updatedAt: new Date().toISOString(),
  };
}

function projectProfilePath(cwd: string | undefined): string {
  const root = typeof cwd === "string" && cwd.trim() ? path.resolve(cwd) : process.cwd();
  return path.join(root, ".zicode", "project.json");
}

function normalizeProjectProfile(value: unknown): ProjectProfile {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const budgetValue = Number(candidate.budget);
  return {
    version: 1,
    instructions: asString(candidate.instructions).slice(0, 50_000),
    defaultScene: asString(candidate.defaultScene) || "programming",
    budget: Number.isFinite(budgetValue) && budgetValue > 0 ? budgetValue : null,
    updatedAt: new Date().toISOString(),
  };
}

function readProjectProfile(profilePath: string): ProjectProfile {
  if (!fs.existsSync(profilePath)) {
    return { version: 1, instructions: "", defaultScene: "programming", budget: null, updatedAt: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath, "utf8")) as Record<string, unknown>;
    const profile = normalizeProjectProfile(parsed);
    profile.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    return profile;
  } catch {
    return { version: 1, instructions: "", defaultScene: "programming", budget: null, updatedAt: null };
  }
}

function openExternal(url: string): void {
  const platform = process.platform;
  const [command, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    execFile(command, args, () => {});
  } catch {
    // Best-effort; frontend falls back to window.open.
  }
}
