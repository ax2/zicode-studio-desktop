import { automationDraftOperation } from "./automation-drafts";
import { readAutomationWorkspaceFile, updateAutomationWorkspaceFile } from "./automation-workspace-repository";
import { modelChannelDocument, providerKeyReference } from "./model-channels";
import {
  qverisHealthFailure,
  qverisHealthHasAssistantText,
  safeModelHealthError,
} from "./model-health-response";
import { fetchOpenAIModelIds } from "./openai-model-catalog";
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
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type CreateAgentSessionOptions,
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type BacktestInput, runBacktest } from "./finance/backtest";
import { type MarketDataSnapshotInput, MarketDataStore } from "./finance/market-data";
import { type NormalizeOhlcvInput, normalizeOhlcv } from "./finance/normalize";
import { PaperTradingLedger } from "./finance/paper-trading";
import {
  QVerisClient,
  readQVerisApiKey,
  setQVerisRuntimeApiKey,
} from "./finance/qveris-client";
import { runScreening, type ScreeningInput } from "./finance/screener";
import {
  fetchQVerisModelCatalog,
} from "./qveris-model-gateway";
import { readTasks, writeTasks } from "./task-repository";

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
  credentialVersions?: Record<string, string>;
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
  getApiKeyForProvider?: (provider: string) => Promise<string | undefined>;
  refresh: () => undefined | Promise<unknown>;
};

type ApiKeyCredential = { type: "api_key"; key: string };

const SUPPORTED_MODEL_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);
const QVERIS_PROVIDER_ID = "qveris";
// Pi 0.84+ resolves custom provider keys from `models.json` env references
// when the runtime credential store is unavailable. The desktop injects the
// scene key as this environment variable at launch.
const QVERIS_API_KEY_REF = "$QVERIS_API_KEY";

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

// Per-application data is workspace-scoped: each project keeps its own
// tasks/finance/automation data under `<workspace>/.zicode/<app>/` (the same
// layout as sessions and notes), so switching workspace switches the data.
function resolveWorkspaceAppDir(): string {
  const explicit = process.env.PI_DESKTOP_WORKSPACE_DIR?.trim();
  const workspaceRoot = explicit ? path.resolve(explicit) : process.cwd();
  return path.join(workspaceRoot, ".zicode");
}

const WORKSPACE_APP_DIR = resolveWorkspaceAppDir();
const SUPER_AGENT_TASKS_PATH = path.join(WORKSPACE_APP_DIR, "tasks", "tasks.json");
const FINANCE_RESEARCH_PATH = path.join(WORKSPACE_APP_DIR, "finance", "research.json");
const AUTOMATION_WORKSPACE_PATH = path.join(WORKSPACE_APP_DIR, "automation", "workflows.json");
const MEMORY_PATH = path.join(process.env.LOCALAPPDATA ?? "", "zicode", "memory.json");
const PISTUDIO_INSTANCES_DIR = process.env.PI_DESKTOP_INSTANCE_DIR
  ? path.join(path.resolve(process.env.PI_DESKTOP_INSTANCE_DIR), "super-agent")
  : path.join(path.dirname(PI_AGENT_ROOT), "instances");

// One-time migration: move legacy scene-scoped app data (written before the
// workspace layout existed) into the owning workspace's `.zicode` directory.
// The first workspace that boots the extension claims the data; the legacy
// file is left untouched when a target already exists or the move fails.
function migrateLegacyAppData(): void {
  const legacy: Array<[string, string]> = [
    [path.join(PI_AGENT_ROOT, "finance", "research.json"), FINANCE_RESEARCH_PATH],
    [path.join(PI_AGENT_ROOT, "automation", "workflows.json"), AUTOMATION_WORKSPACE_PATH],
  ];
  for (const [source, target] of legacy) {
    if (!fs.existsSync(source) || fs.existsSync(target)) continue;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(source, target);
    } catch {
      // Keep the legacy file in place; the next read falls back to it.
    }
  }
}

migrateLegacyAppData();

// Prefer the workspace-scoped file, but keep reading/writing the legacy
// scene-scoped file when the migration could not move it yet, so data is
// never silently split or lost.
function dataFileFor(workspacePath: string, legacyPath: string): string {
  return fs.existsSync(workspacePath) ? workspacePath : legacyPath;
}

// Writes always land in the workspace-scoped file; when the legacy file still
// exists (migration could not run), move it first so data is never split.
function workspaceDataPath(workspacePath: string, legacyPath: string): string {
  if (!fs.existsSync(workspacePath) && fs.existsSync(legacyPath)) {
    try {
      fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
      fs.renameSync(legacyPath, workspacePath);
    } catch {
      // Keep the legacy file; the read fallback keeps data visible.
    }
  }
  return workspacePath;
}

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
  if (typeof candidate.error === "string") health.error = safeModelHealthError(candidate.error);
  return health;
}

class ModelPreferencesStore {
  readonly path: string;
  private migrationDeferred = false;

  constructor(filePath = MODELS_PREFS_PATH) {
    this.path = filePath;
  }

  private readSnapshot(): { preferences: Required<ModelPreferencesFile>; needsMigration: boolean } {
    const empty = { visibility: {}, health: {}, credentialVersions: {} };
    if (!fs.existsSync(this.path)) return { preferences: empty, needsMigration: false };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf8")) as ModelPreferencesFile;
      const healthEntries =
        parsed.health && typeof parsed.health === "object" && !Array.isArray(parsed.health)
          ? Object.entries(parsed.health)
          : [];
      const health = Object.fromEntries(
        healthEntries.map(([key, value]) => [key, normalizeModelHealth(value)]),
      );
      const needsMigration = healthEntries.some(([, value]) => {
        const original = value as Partial<ModelHealth> | null;
        return (
          typeof original?.error === "string" &&
          original.error !== normalizeModelHealth(value).error
        );
      });
      return { preferences: {
        visibility:
          parsed.visibility &&
          typeof parsed.visibility === "object" &&
          !Array.isArray(parsed.visibility)
            ? parsed.visibility
            : {},
        health,
        credentialVersions:
          parsed.credentialVersions &&
          typeof parsed.credentialVersions === "object" &&
          !Array.isArray(parsed.credentialVersions)
            ? Object.fromEntries(
                Object.entries(parsed.credentialVersions).filter(
                  ([, value]) => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value),
                ),
              )
            : {},
      }, needsMigration };
    } catch {
      return { preferences: empty, needsMigration: false };
    }
  }

  private withLock(action: () => void): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    let lockFd: number | undefined;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        lockFd = fs.openSync(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (attempt === 79) throw new Error("model_preferences_busy");
        Atomics.wait(pause, 0, 0, 25);
      }
    }
    if (lockFd === undefined) throw new Error("model_preferences_busy");
    try {
      action();
    } finally {
      fs.closeSync(lockFd);
      fs.unlinkSync(lockPath);
    }
  }

  private write(next: Required<ModelPreferencesFile>): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(next, null, 2), "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, this.path);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  read(): Required<ModelPreferencesFile> {
    const snapshot = this.readSnapshot();
    if (snapshot.needsMigration && !this.migrationDeferred) {
      try {
        this.withLock(() => {
          const latest = this.readSnapshot();
          if (latest.needsMigration) this.write(latest.preferences);
        });
      } catch {
        // The in-memory result is safe; retry on the next configuration operation.
        this.migrationDeferred = true;
      }
    }
    return snapshot.preferences;
  }

  isVisible(provider: string, modelId: string): boolean {
    return this.read().visibility[modelPreferenceKey(provider, modelId)] !== false;
  }

  setVisibility(provider: string, modelId: string, visible: boolean): void {
    this.withLock(() => {
      const prefs = this.readSnapshot().preferences;
      prefs.visibility[modelPreferenceKey(provider, modelId)] = visible;
      this.write(prefs);
    });
  }

  getHealth(provider: string, modelId: string): ModelHealth {
    return normalizeModelHealth(this.read().health[modelPreferenceKey(provider, modelId)]);
  }

  credentialVersion(provider: string): string {
    return this.read().credentialVersions[provider] ?? "";
  }

  rotateCredential(provider: string): void {
    this.withLock(() => {
      const prefs = this.readSnapshot().preferences;
      prefs.credentialVersions[provider] = randomUUID();
      for (const key of Object.keys(prefs.health)) {
        if (key.startsWith(`${provider}/`)) delete prefs.health[key];
      }
      this.write(prefs);
    });
  }

  setHealthIfCredentialCurrent(
    provider: string,
    modelId: string,
    health: ModelHealth,
    expectedVersion: string,
  ): boolean {
    let saved = false;
    this.withLock(() => {
      const prefs = this.readSnapshot().preferences;
      if ((prefs.credentialVersions[provider] ?? "") !== expectedVersion) return;
      prefs.health[modelPreferenceKey(provider, modelId)] = normalizeModelHealth(health);
      this.write(prefs);
      saved = true;
    });
    return saved;
  }
}

async function buildModelCatalog(registry: CatalogRegistry, preferences: ModelPreferencesStore) {
  const allModels = registry.getAll();
  const availableModels = await registry.getAvailable();
  const channelConfigs = readModelsDocument().providers;
  const availableKeys = new Set(
    availableModels
      .filter((model) => model.provider && model.id)
      .map((model) => modelPreferenceKey(model.provider as string, model.id as string)),
  );
  const providerNames = Array.from(
    new Set([
      ...allModels
        .map((model) => model.provider)
        .filter((provider): provider is string => typeof provider === "string" && provider.length > 0),
      ...Object.keys(channelConfigs),
    ]),
  ).filter((providerName) => channelConfigs[providerName]?.enabled !== false).sort();

  return {
    providers: providerNames.map((providerName) => {
      const status = registry.getProviderAuthStatus(providerName);
      const stored = hasStoredApiKey(providerName);
      return {
        provider: providerName,
        displayName:
          asString(channelConfigs[providerName]?.displayName) || (providerName === QVERIS_PROVIDER_ID
            ? "QVeris Model Gateway"
            : registry.getProviderDisplayName(providerName)),
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
  const original = readModelsDocument().providers[provider];
  const originalRevision = original ? channelRevision(original) : null;
  const originalCredentialVersion = preferences.credentialVersion(provider);
  const publish = (result: { provider: string; modelId: string } & ModelHealth) => {
    let current: Record<string, unknown> | undefined;
    let readable = true;
    try {
      current = readModelsDocument().providers[provider];
    } catch {
      readable = false;
    }
    if (
      !readable ||
      (current ? channelRevision(current) : null) !== originalRevision ||
      current?.enabled === false
    ) {
      return {
        ...result,
        status: "unknown" as const,
        error: "Model channel changed while testing. Refresh and try again.",
      };
    }
    if (
      !preferences.setHealthIfCredentialCurrent(
        provider,
        modelId,
        result,
        originalCredentialVersion,
      )
    ) {
      return {
        ...result,
        status: "unknown" as const,
        error: "Model credentials changed while testing. Refresh and try again.",
      };
    }
    return result;
  };
  let sawAssistantText = false;
  try {
    requireEnabledModelChannel(provider);
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
        requireEnabledModelChannel(provider);
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
        if (!response.ok) {
          throw new Error(await qverisHealthFailure(response));
        }
        sawAssistantText = await qverisHealthHasAssistantText(response);
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
      return publish(result);
    }
    const modelRuntime = await ModelRuntime.create();
    const { session } = await createAgentSession({
      // The Pi registry supplies full SDK models; CatalogModel keeps only fields used by this UI.
      model: model as unknown as NonNullable<CreateAgentSessionOptions["model"]>,
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
        requireEnabledModelChannel(provider);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            session.prompt("Reply exactly: OK"),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                void session.abort().catch(() => undefined);
                reject(new Error("Model health check timed out"));
              }, 30_000);
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
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
    return publish(result);
  } catch (e: unknown) {
    const result: { provider: string; modelId: string } & ModelHealth = {
      provider,
      modelId,
      status: "unhealthy",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error: safeModelHealthError(e),
    };
    return publish(result);
  }
}

function qverisGatewayBaseUrl(): string {
  const config = readModelsDocument().providers[QVERIS_PROVIDER_ID];
  if (!config) throw new Error("Configure the model channel before syncing its catalog.");
  return validateBaseUrl(config.baseUrl);
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

/**
 * Keep a small rolling history of a workspace state file before it is
 * overwritten, so an accidental bad write (a buggy client, a stale QA run, a
 * crash mid-write) always has a recent recovery point even when the daily
 * startup backup has not run yet. Snapshots are best-effort: a failure here
 * must never block the primary write.
 */
function snapshotFileBeforeWrite(filePath: string, keep = 7): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const historyDir = path.join(path.dirname(filePath), ".history");
    fs.mkdirSync(historyDir, { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 23);
    const target = path.join(
      historyDir,
      `snapshot-${stamp}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    fs.copyFileSync(filePath, target);
    const entries = fs
      .readdirSync(historyDir)
      .filter((name) => name.startsWith("snapshot-") && name.endsWith(".json"))
      .sort();
    while (entries.length > keep) {
      const oldest = entries.shift();
      if (oldest) {
        try {
          fs.rmSync(path.join(historyDir, oldest), { force: true });
        } catch {
          // Ignore per-file prune failures; the history is best-effort.
        }
      }
    }
  } catch {
    // Snapshotting is best-effort; the primary write must not fail because of it.
  }
}

function readModelsDocument(): {
  providers: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
} {
  const parsed = fs.existsSync(MODELS_CONFIG_PATH)
    ? (JSON.parse(fs.readFileSync(MODELS_CONFIG_PATH, "utf8")) as Record<string, unknown>)
    : {};
  return modelChannelDocument(parsed);
}

export function isModelChannelDisabled(provider: string): boolean {
  return readModelsDocument().providers[provider]?.enabled === false;
}

function requireEnabledModelChannel(provider: string): void {
  if (isModelChannelDisabled(provider)) {
    throw new Error("Model channel is disabled. Enable it before making requests.");
  }
}

function withModelsDocumentLock<T>(action: () => T): T {
  fs.mkdirSync(path.dirname(MODELS_CONFIG_PATH), { recursive: true });
  const lockPath = `${MODELS_CONFIG_PATH}.lock`;
  let lockFd: number;
  try {
    lockFd = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("model_channel_busy");
    throw error;
  }
  try {
    return action();
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lockPath);
  }
}

function writeModelsContent(content: string): void {
  const temporary = `${MODELS_CONFIG_PATH}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, content, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, MODELS_CONFIG_PATH);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function writeModelsDocument(document: Record<string, unknown>): void {
  writeModelsContent(`${JSON.stringify(document, null, 2)}\n`);
}

async function syncQVerisModelCatalog(
  registry?: CatalogRegistry,
  apiKey = readQVerisApiKey(),
): Promise<{ count: number; refreshed: boolean }> {
  if (!apiKey) throw new Error("QVeris API Key is not configured for this scene");
  const document = readModelsDocument();
  const current = document.providers[QVERIS_PROVIDER_ID];
  if (!current) throw new Error("Configure the model channel before syncing its catalog.");
  requireEnabledModelChannel(QVERIS_PROVIDER_ID);
  const baseUrl = validateBaseUrl(current.baseUrl);
  const models = await fetchQVerisModelCatalog(apiKey, { baseUrl });
  withModelsDocumentLock(() => {
    const latest = readModelsDocument();
    if (JSON.stringify(latest.providers[QVERIS_PROVIDER_ID]) !== JSON.stringify(current)) {
      throw new Error("Model channel changed while syncing. Refresh and try again.");
    }
    latest.providers[QVERIS_PROVIDER_ID] = {
      ...current,
      baseUrl,
      api: "openai-completions",
      authHeader: true,
      apiKey: QVERIS_API_KEY_REF,
      models,
    };
    writeModelsDocument(latest);
  });
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
  if (parsed.search || parsed.hash || baseUrl.includes("?") || baseUrl.includes("#")) {
    throw new Error("baseUrl must not contain a query or fragment");
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
    if (Array.from(name).length > 100) throw new Error("Model names must be at most 100 characters.");
    if (name) normalized.name = name;
    if (typeof model.reasoning === "boolean") normalized.reasoning = model.reasoning;
    const contextWindow = asNumber(model.contextWindow);
    if (contextWindow && contextWindow > 0) normalized.contextWindow = Math.trunc(contextWindow);
    const maxTokens = asNumber(model.maxTokens);
    if (maxTokens && maxTokens > 0) normalized.maxTokens = Math.trunc(maxTokens);
    if (model.cost !== undefined) {
      if (!model.cost || typeof model.cost !== "object" || Array.isArray(model.cost)) {
        throw new Error("Model cost must be an object.");
      }
      const cost = model.cost as Record<string, unknown>;
      if (typeof cost.input !== "number" || typeof cost.output !== "number") {
        throw new Error("Model cost needs both input and output prices.");
      }
      const normalizedCost: Record<string, number> = {};
      for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
        if (cost[key] === undefined) continue;
        const price = cost[key];
        if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000) {
          throw new Error("Model cost must contain nonnegative per-million-token prices.");
        }
        normalizedCost[key] = price;
      }
      if (Object.keys(normalizedCost).length > 0) normalized.cost = normalizedCost;
    }
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
        requireEnabledModelChannel(provider);
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
        const results: Awaited<ReturnType<typeof runModelHealthCheck>>[] = [];
        // Probe with bounded concurrency so a 25-model channel finishes in a
        // few seconds instead of running sequentially past the UI timeout.
        const CONCURRENCY = 5;
        let nextIndex = 0;
        const workers = Array.from({ length: Math.min(CONCURRENCY, models.length) }, async () => {
          while (nextIndex < models.length) {
            const model = models[nextIndex];
            nextIndex += 1;
            const result = await runModelHealthCheck(reg, model, preferences);
            // A 404 `model_not_found` is definitive: that id does not exist on
            // the chat gateway. Keep the composer dropdown clean by hiding
            // such entries; they remain visible in the configuration model
            // list where the user can re-enable them if upstream changes.
            if (result.status === "unhealthy" && /model_not_found/i.test(result.error ?? "")) {
              preferences.setVisibility(provider, model.id as string, false);
            }
            results.push(result);
          }
        });
        await Promise.all(workers);
        return { ok: true, data: { results } };
      }

      case "set_api_key": {
        const provider = validateProviderId(params.provider);
        const apiKey = asString(params.apiKey);
        if (!apiKey) throw new Error("apiKey is required");
        await setStoredApiKey(registry, provider, apiKey);
        preferences.rotateCredential(provider);
        if (provider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(apiKey);
        if (registry) await registry.refresh();
        await sealBrokerAuthConfig(registry);
        return { ok: true, data: { provider } };
      }

      case "remove_api_key": {
        const provider = validateProviderId(params.provider);
        await removeStoredApiKey(registry, provider);
        preferences.rotateCredential(provider);
        if (provider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(null);
        if (registry) await registry.refresh();
        await sealBrokerAuthConfig(registry);
        return { ok: true, data: { provider } };
      }

      case "list_provider_channels": {
        const document = readModelsDocument();
        const channels = Object.entries(document.providers).map(([provider, config]) => ({
          provider,
          displayName: asString(config.displayName),
          baseUrl: asString(config.baseUrl),
          api: asString(config.api) || "openai-completions",
          enabled: config.enabled !== false,
          authHeader: config.authHeader !== false,
          revision: channelRevision(config),
          models: Array.isArray(config.models) ? config.models : [],
          builtIn: false,
          catalogSync:
            provider === QVERIS_PROVIDER_ID
              ? "qveris"
              : ["openai-completions", "openai-responses"].includes(asString(config.api))
                ? "openai"
                : null,
          configured:
            registry?.getProviderAuthStatus(provider)?.configured === true ||
            hasStoredApiKey(provider),
        }));
        return { ok: true, data: { channels } };
      }

      case "test_provider_channel": {
        const provider = validateProviderId(params.provider);
        let config: Record<string, unknown> | undefined;
        try {
          config = readModelsDocument().providers[provider];
        } catch {
          throw new Error("Could not read model channel configuration.");
        }
        if (!config) throw new Error("Model channel no longer exists. Refresh and try again.");
        requireEnabledModelChannel(provider);
        const revision = channelRevision(config);
        const modelIds = Array.isArray(config.models)
          ? config.models.map((model) => asString((model as { id?: unknown })?.id)).filter(Boolean)
          : [];
        const startedAt = Date.now();
        let status: "connected" | "failed" = "connected";
        let method: "model" | "catalog" = "catalog";
        let modelCount = 0;
        let error: string | undefined;
        if (modelIds.length > 0) {
          const model = requireRegistry().getAll().find((entry) => entry.provider === provider && modelIds.includes(entry.id || ""));
          if (!model) throw new Error("Configured model is unavailable. Refresh the channel and try again.");
          const result = await runModelHealthCheck(requireRegistry(), model, preferences);
          method = "model";
          status = result.status === "healthy" ? "connected" : "failed";
          error = result.error;
        } else if (provider === QVERIS_PROVIDER_ID) {
          const key = readQVerisApiKey();
          if (!key) throw new Error("Configure this channel's API key before testing its connection.");
          requireEnabledModelChannel(provider);
          modelCount = (await fetchQVerisModelCatalog(key, { baseUrl: validateBaseUrl(config.baseUrl) })).length;
        } else if (["openai-completions", "openai-responses"].includes(asString(config.api))) {
          const key = config.authHeader === false ? undefined : await registry?.getApiKeyForProvider?.(provider);
          if (config.authHeader !== false && !key) {
            throw new Error("Configure this channel's API key before testing its connection.");
          }
          requireEnabledModelChannel(provider);
          modelCount = (await fetchOpenAIModelIds(validateBaseUrl(config.baseUrl), key)).length;
        } else {
          throw new Error("Add a model ID before testing this channel's connection.");
        }
        let latest: Record<string, unknown> | undefined;
        try {
          latest = readModelsDocument().providers[provider];
        } catch {
          throw new Error("Could not read model channel configuration.");
        }
        if (!latest || channelRevision(latest) !== revision) {
          throw new Error("Model channel changed while testing. Refresh and try again.");
        }
        return { ok: true, data: { provider, connection: { status, method, modelCount, latencyMs: Date.now() - startedAt, error } } };
      }

      case "sync_qveris_models": {
        const modelSync = await syncQVerisModelCatalog(registry);
        return { ok: true, data: { provider: QVERIS_PROVIDER_ID, modelSync } };
      }

      case "discover_provider_models": {
        const provider = validateProviderId(params.provider);
        const config = readModelsDocument().providers[provider];
        if (!config) throw new Error("Model channel no longer exists. Refresh and try again.");
        requireEnabledModelChannel(provider);
        const api = asString(config.api);
        if (!["openai-completions", "openai-responses"].includes(api) || provider === QVERIS_PROVIDER_ID) {
          throw new Error("Model discovery requires an OpenAI-compatible channel.");
        }
        const revision = channelRevision(config);
        const baseUrl = validateBaseUrl(config.baseUrl);
        const apiKey = config.authHeader === false
          ? undefined
          : await registry?.getApiKeyForProvider?.(provider);
        if (config.authHeader !== false && !apiKey) {
          throw new Error("Configure this channel's API key before discovering models.");
        }
        requireEnabledModelChannel(provider);
        const models = await fetchOpenAIModelIds(baseUrl, apiKey);
        const latest = readModelsDocument().providers[provider];
        if (!latest || channelRevision(latest) !== revision) {
          throw new Error("Model channel changed while syncing. Refresh and try again.");
        }
        return {
          ok: true,
          data: {
            provider,
            models,
            revision,
            channel: {
              provider,
              baseUrl,
              api,
              authHeader: config.authHeader !== false,
              models: Array.isArray(config.models)
                ? config.models.map((model) => ({ id: asString((model as { id?: unknown })?.id) }))
                : [],
            },
          },
        };
      }

      case "save_provider_channel": {
        const provider = validateProviderId(params.provider);
        const originalProvider = params.originalProvider
          ? validateProviderId(params.originalProvider)
          : provider;
        const baseUrl = validateBaseUrl(params.baseUrl);
        const api = asString(params.api) || "openai-completions";
        const displayName = asString(params.displayName);
        const nameCharacters = Array.from(displayName);
        if (nameCharacters.length > 100 || nameCharacters.some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
          throw new Error("Channel display name must be at most 100 readable characters.");
        }
        if (!SUPPORTED_MODEL_APIS.has(api)) throw new Error(`unsupported API type: ${api}`);
        const authHeader = withModelsDocumentLock(() => {
          const document = readModelsDocument();
          if ((params.createOnly === true || originalProvider !== provider) && document.providers[provider]) {
            throw new Error("A channel with this ID already exists.");
          }
          const copySourceProvider = params.copySourceProvider
            ? validateProviderId(params.copySourceProvider)
            : "";
          if (copySourceProvider && (params.createOnly !== true || originalProvider !== provider)) {
            throw new Error("Copying a channel requires a new channel ID.");
          }
          const source = copySourceProvider ? document.providers[copySourceProvider] : null;
          if (copySourceProvider && (!source || channelRevision(source) !== asString(params.copySourceRevision))) {
            throw new Error("Source channel changed. Refresh and copy it again.");
          }
          const existing = source ? { models: source.models } : document.providers[originalProvider] || {};
          const expectedRevision = asString(params.expectedRevision);
          if (expectedRevision && channelRevision(existing) !== expectedRevision) {
            throw new Error("Model channel changed while syncing. Refresh and try again.");
          }
          const models =
            ["openai-completions", "openai-responses"].includes(api) && Array.isArray(params.models) && params.models.length === 0
              ? Array.isArray(existing.models)
                ? existing.models
                : []
              : normalizeChannelModels(params.models);
          const oldModels = new Map(
            (Array.isArray(existing.models) ? existing.models : [])
              .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === "object" && !Array.isArray(model))
              .map((model) => [asString(model.id), model]),
          );
          const preservedModels = models.map((model) => {
            const old = oldModels.get(asString(model.id));
            const merged = { ...old, ...model };
            if (model.cost && typeof model.cost === "object" && !Array.isArray(model.cost)) {
              merged.cost = {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                ...(old?.cost && typeof old.cost === "object" && !Array.isArray(old.cost) ? old.cost : {}),
                ...model.cost,
              };
            }
            return merged;
          });
          if (originalProvider !== provider) delete document.providers[originalProvider];
          const authHeader = params.authHeader !== false;
          const nextConfig: Record<string, unknown> = {
            ...existing,
            baseUrl,
            api,
            authHeader,
            models: preservedModels,
          };
          if (params.displayName !== undefined) {
            if (displayName) nextConfig.displayName = displayName;
            else delete nextConfig.displayName;
          }
          if (authHeader) nextConfig.apiKey = providerKeyReference(provider);
          else delete nextConfig.apiKey;
          document.providers[provider] = nextConfig;
          writeModelsDocument(document);
          return authHeader;
        });
        const apiKey = authHeader ? asString(params.apiKey) : "";
        if (apiKey) {
          await setStoredApiKey(registry, provider, apiKey);
          preferences.rotateCredential(provider);
          if (provider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(apiKey);
        }
        if (originalProvider !== provider) {
          await removeStoredApiKey(registry, originalProvider);
          preferences.rotateCredential(originalProvider);
          if (originalProvider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(null);
        }
        const refreshed = await refreshRegistry(registry);
        await sealBrokerAuthConfig(registry);
        return { ok: true, data: { provider, refreshed } };
      }

      case "set_provider_channel_enabled": {
        const provider = validateProviderId(params.provider);
        if (typeof params.enabled !== "boolean") {
          throw new Error("Channel state must be enabled or disabled.");
        }
        const expectedRevision = asString(params.expectedRevision);
        if (!expectedRevision) {
          throw new Error("Channel revision is unavailable. Refresh and try again.");
        }
        withModelsDocumentLock(() => {
          const document = readModelsDocument();
          const current = document.providers[provider];
          if (!current || channelRevision(current) !== expectedRevision) {
            throw new Error("Model channel changed while syncing. Refresh and try again.");
          }
          document.providers[provider] = { ...current, enabled: params.enabled };
          writeModelsDocument(document);
        });
        const refreshed = await refreshRegistry(registry);
        let brokerSealed = true;
        try {
          await sealBrokerAuthConfig(registry);
        } catch {
          brokerSealed = false;
        }
        return { ok: true, data: { provider, enabled: params.enabled, runtimeReady: refreshed && brokerSealed } };
      }

      case "remove_provider_channel": {
        const provider = validateProviderId(params.provider);
        withModelsDocumentLock(() => {
          const document = readModelsDocument();
          const existing = document.providers[provider];
          const expectedRevision = asString(params.expectedRevision);
          if (expectedRevision && (!existing || channelRevision(existing) !== expectedRevision)) {
            throw new Error("Model channel changed while syncing. Refresh and try again.");
          }
          delete document.providers[provider];
          writeModelsDocument(document);
        });
        if (provider === QVERIS_PROVIDER_ID) setQVerisRuntimeApiKey(null);
        await removeStoredApiKey(registry, provider);
        preferences.rotateCredential(provider);
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
        if (action === "remove") {
          return { ok: true, data: ledger.removeAccount(asString(params.accountId)) };
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

      case "automation_drafts":
        return { ok: true, data: automationDraftOperation(path.join(WORKSPACE_APP_DIR, "automation", "drafts.json"), params) };

      case "automation_workspace": {
        const action = asString(params.action) || "list";
        if (action === "list") return { ok: true, data: readAutomationWorkspace() };
        if (action === "upsert") {
          const workflow = normalizeAutomationWorkflow(params.workflow);
          const workspace = updateAutomationWorkspaceFile(
            AUTOMATION_WORKSPACE_PATH,
            path.join(PI_AGENT_ROOT, "automation", "workflows.json"),
            params.expectedRevision,
            normalizeAutomationWorkflow,
            (workflows) => {
              const index = workflows.findIndex((item) => item.id === workflow.id);
              const saved = index >= 0
                ? mergeAutomationEdit(workflows[index], workflow)
                : workflow;
              if (index >= 0) workflows[index] = saved;
              else workflows.unshift(saved);
              return { workflows, value: saved };
            },
            snapshotFileBeforeWrite,
          );
          return { ok: true, data: { workflow: workspace.value, workspace } };
        }
        if (action === "remove") {
          const id = asString(params.id);
          const workspace = updateAutomationWorkspaceFile(
            AUTOMATION_WORKSPACE_PATH,
            path.join(PI_AGENT_ROOT, "automation", "workflows.json"),
            params.expectedRevision,
            normalizeAutomationWorkflow,
            (workflows) => ({ workflows: workflows.filter((item) => item.id !== id) }),
            snapshotFileBeforeWrite,
          );
          return { ok: true, data: workspace };
        }
        if (action === "record_run") {
          const id = asString(params.id);
          const workspace = updateAutomationWorkspaceFile(
            AUTOMATION_WORKSPACE_PATH,
            path.join(PI_AGENT_ROOT, "automation", "workflows.json"),
            params.expectedRevision,
            normalizeAutomationWorkflow,
            (workflows) => {
              const index = workflows.findIndex((item) => item.id === id);
              if (index < 0) throw new Error("automation workflow was not found");
              const current = workflows[index];
              const run = normalizeAutomationRun(params.run);
              if (current.history.some((item) => item.id === run.id))
                return { workflows, value: current };
              current.history = [run, ...current.history].slice(0, 100);
              current.lastRunAt = run.startedAt;
              current.nextRunAt = asString(params.nextRunAt) || null;
              current.approvalPending = params.approvalPending === true;
              current.updatedAt = new Date().toISOString();
              return { workflows, value: current };
            },
            snapshotFileBeforeWrite,
          );
          return { ok: true, data: { workflow: workspace.value, workspace } };
        }
        throw new Error("unsupported automation action");
      }

      case "read_agent_config":
        return { ok: true, data: readConfigFile(AGENT_CONFIG_PATH, "{}") };

      case "write_agent_config": {
        writeConfigFile(AGENT_CONFIG_PATH, params.content);
        return { ok: true, data: { path: AGENT_CONFIG_PATH } };
      }

      case "read_models_config": {
        const file = readConfigFile(MODELS_CONFIG_PATH, '{\n  "providers": {}\n}\n');
        return { ok: true, data: { ...file, revision: projectProfileRevision(file.content) } };
      }

      case "write_models_config": {
        const content = params.content;
        if (typeof content !== "string") throw new Error("content must be a string");
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("models.json must be a JSON object");
        }
        if (
          "providers" in parsed &&
          (!parsed.providers || typeof parsed.providers !== "object" || Array.isArray(parsed.providers))
        ) {
          throw new Error("'providers' must be an object");
        }
        const expectedRevision = asString(params.expectedRevision);
        if (!/^[a-f0-9]{64}$/.test(expectedRevision)) {
          throw new Error("Channel revision is unavailable. Refresh or update the desktop runtime before editing.");
        }
        withModelsDocumentLock(() => {
          const current = readConfigFile(MODELS_CONFIG_PATH, '{\n  "providers": {}\n}\n');
          if (projectProfileRevision(current.content) !== expectedRevision) {
            throw new Error("Model channel changed while syncing. Refresh and try again.");
          }
          writeModelsContent(content);
        });
        const refreshed = await refreshRegistry(registry);
        return { ok: true, data: { path: MODELS_CONFIG_PATH, revision: projectProfileRevision(content), refreshed } };
      }

      case "read_chat_config":
        return { ok: true, data: readConfigFile(CHAT_CONFIG_PATH, "{}") };

      case "write_chat_config": {
        writeConfigFile(CHAT_CONFIG_PATH, params.content);
        return { ok: true, data: { path: CHAT_CONFIG_PATH } };
      }

      case "read_project_profile": {
        const profilePath = projectProfilePath(ctx.cwd);
        const snapshot = readProjectProfileSnapshot(profilePath);
        return { ok: true, data: { ...snapshot, path: profilePath } };
      }

      case "write_project_profile": {
        const profilePath = projectProfilePath(ctx.cwd);
        const profile = normalizeProjectProfile(params.profile);
        const revision = writeProjectProfile(profilePath, profile, params.expectedRevision);
        return { ok: true, data: { profile, revision, path: profilePath } };
      }

      case "read_super_agent_tasks": {
        return { ok: true, data: readTasks(SUPER_AGENT_TASKS_PATH, path.join(PI_AGENT_ROOT, "super-agent", "tasks.json")) };
      }

      case "read_memory": {
        const fallback = { version: 1, enabled: true, entries: [] as unknown[] };
        if (!fs.existsSync(MEMORY_PATH)) return { ok: true, data: fallback };
        try {
          const parsed = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8")) as {
            enabled?: boolean;
            entries?: unknown[];
          };
          return {
            ok: true,
            data: {
              version: 1,
              enabled: parsed.enabled !== false,
              entries: Array.isArray(parsed.entries)
                ? parsed.entries.filter(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      typeof (entry as { text?: unknown }).text === "string",
                  )
                : [],
            },
          };
        } catch {
          return { ok: true, data: fallback };
        }
      }

      case "write_memory": {
        const entries = Array.isArray(params.entries)
          ? params.entries
              .map((entry) => {
                const text = asString((entry as { text?: unknown })?.text).trim();
                if (!text) return null;
                return {
                  id: asString((entry as { id?: unknown })?.id) ||
                    `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  text: text.slice(0, 2_000),
                  updatedAt: asString((entry as { updatedAt?: unknown })?.updatedAt) ||
                    new Date().toISOString(),
                };
              })
              .filter(Boolean)
          : [];
        const payload = {
          version: 1,
          enabled: params.enabled !== false,
          entries,
        };
        fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
        fs.writeFileSync(MEMORY_PATH, JSON.stringify(payload, null, 2), "utf8");
        return { ok: true, data: payload };
      }

      case "write_super_agent_tasks": {
        const saved = writeTasks(SUPER_AGENT_TASKS_PATH, params.tasks, params.revision, snapshotFileBeforeWrite, path.join(PI_AGENT_ROOT, "super-agent", "tasks.json"));
        return { ok: true, data: { ...saved, count: saved.tasks.length } };
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
const PROJECT_PROFILE_MAX_BYTES = 256 * 1024;

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

type AutomationWorkspace = { version: 1; workflows: AutomationWorkflow[]; revision: string };

function readAutomationWorkspace(): AutomationWorkspace {
  return readAutomationWorkspaceFile(
    AUTOMATION_WORKSPACE_PATH,
    path.join(PI_AGENT_ROOT, "automation", "workflows.json"),
    normalizeAutomationWorkflow,
  );
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

function mergeAutomationEdit(current: AutomationWorkflow, edited: AutomationWorkflow): AutomationWorkflow {
  const scheduleChanged =
    current.enabled !== edited.enabled ||
    current.schedule !== edited.schedule ||
    current.intervalMinutes !== edited.intervalMinutes ||
    current.dailyTime !== edited.dailyTime;
  return {
    ...current,
    title: edited.title,
    prompt: edited.prompt,
    targetProject: edited.targetProject,
    enabled: edited.enabled,
    schedule: edited.schedule,
    intervalMinutes: edited.intervalMinutes,
    dailyTime: edited.dailyTime,
    requireApproval: edited.requireApproval,
    maxCost: edited.maxCost,
    maxRetries: edited.maxRetries,
    nextRunAt: scheduleChanged ? edited.nextRunAt : current.nextRunAt,
    updatedAt: new Date().toISOString(),
  };
}

function readFinanceResearchWorkspace(): FinanceResearchWorkspace {
  const dataPath = dataFileFor(
    FINANCE_RESEARCH_PATH,
    path.join(PI_AGENT_ROOT, "finance", "research.json"),
  );
  if (!fs.existsSync(dataPath)) return { version: 1, cards: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8")) as { cards?: unknown[] };
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
  const target = workspaceDataPath(
    FINANCE_RESEARCH_PATH,
    path.join(PI_AGENT_ROOT, "finance", "research.json"),
  );
  writeConfigFile(target, JSON.stringify(workspace, null, 2));
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

function projectProfileRevision(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function channelRevision(config: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function readProjectProfileSnapshot(profilePath: string): {
  profile: ProjectProfile;
  revision: string;
} {
  const directory = path.dirname(profilePath);
  const directoryEntry = projectProfileEntry(directory);
  if (directoryEntry && (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink())) {
    throw new Error("project_profile_invalid");
  }
  const file = projectProfileEntry(profilePath);
  if (!file) {
    return {
      profile: { version: 1, instructions: "", defaultScene: "programming", budget: null, updatedAt: null },
      revision: projectProfileRevision("missing"),
    };
  }
  try {
    if (!file.isFile() || file.size > PROJECT_PROFILE_MAX_BYTES) throw new Error("project_profile_invalid");
    const bytes = fs.readFileSync(profilePath);
    if (bytes.length > PROJECT_PROFILE_MAX_BYTES) throw new Error("project_profile_invalid");
    const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.instructions !== "string" ||
      parsed.instructions.length > 50_000 ||
      typeof parsed.defaultScene !== "string" ||
      (parsed.budget !== null && (typeof parsed.budget !== "number" || !Number.isFinite(parsed.budget)))
    ) {
      throw new Error("project_profile_invalid");
    }
    const profile = normalizeProjectProfile(parsed);
    profile.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    return { profile, revision: projectProfileRevision(bytes) };
  } catch {
    throw new Error("project_profile_invalid");
  }
}

function projectProfileEntry(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("project_profile_invalid");
  }
}

function writeProjectProfile(profilePath: string, profile: ProjectProfile, expected: unknown): string {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("project_profile_revision_required");
  }
  const content = `${JSON.stringify(profile, null, 2)}\n`;
  if (Buffer.byteLength(content) > PROJECT_PROFILE_MAX_BYTES) {
    throw new Error("project_profile_invalid");
  }
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  // Reject damaged files and linked resource directories before creating the lock.
  readProjectProfileSnapshot(profilePath);
  const lock = `${profilePath}.lock`;
  let lockFd: number;
  try {
    lockFd = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("project_profile_busy");
    throw error;
  }
  try {
    const current = readProjectProfileSnapshot(profilePath);
    if (current.revision !== expected) throw new Error("project_profile_conflict");
    snapshotFileBeforeWrite(profilePath);
    const temporary = `${profilePath}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(fd, content, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, profilePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return projectProfileRevision(content);
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
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
