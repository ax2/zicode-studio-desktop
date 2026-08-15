import { useMemo, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import {
  asArray,
  FINANCE_VIEWS,
  financeGroupLabel,
  financeViewLabel,
  number,
  percent,
  sampleBacktest,
  samplePaperLimit,
  samplePaperMark,
  samplePaperOrder,
  sampleScreening,
  sampleSnapshot,
  type FinanceViewDefinition,
} from "./financeWorkbenchLogic";
import type { FinanceWorkbenchStoreHook } from "./financeWorkbenchStore";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export interface FinanceWorkbenchController {
  selectView(id: string): void;
  openConfiguration(): void;
  openSceneSettings(): void;
  createFinanceSession(): Promise<unknown>;
  runUsage(): void;
  runDiscovery(query: string): void;
  saveSnapshot(input: string): void;
  listSnapshots(): void;
  runBacktest(input: string): void;
  runScreening(input: string): void;
  refreshResearch(): void;
  saveResearchCard(card: Record<string, unknown>): void;
  removeResearchCard(id: string): void;
  refreshPaperAccounts(): void;
  createPaperAccount(account: {
    name: string;
    baseCurrency: string;
    initialCash: number;
  }): void;
  recordPaperOrder(input: string): void;
  manageLimitOrder(input: string): void;
  markPortfolio(input: string): void;
}

function ResultMessage({ value }: { value: string }) {
  return <p className="finance-message">{value}</p>;
}

function CopyResultButton({ response }: { response: unknown }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(JSON.stringify(response, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; keep the label as "Copy result".
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(response, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "zicode-result.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <>
      <button
        type="button"
        className="ui-button ui-button--ghost ui-button--sm finance-result-copy"
        onClick={() => void copy()}
      >
        {copied ? t("Copied") : t("Copy result")}
      </button>
      <button
        type="button"
        className="ui-button ui-button--ghost ui-button--sm finance-result-download"
        onClick={download}
      >
        {t("Download")}
      </button>
    </>
  );
}

function MetricGrid({
  entries,
  percentLabels = [],
}: {
  entries: Array<[string, unknown]>;
  percentLabels?: string[];
}) {
  return (
    <div className="finance-metrics">
      {entries.map(([label, value]) => (
        <div className="finance-metric" key={label}>
          <span>{label}</span>
          <strong>{percentLabels.includes(label) ? percent(value) : number(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function DiscoveryResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Capability discovery failed.")} />;
  }
  const results = asArray(result.data?.results);
  if (!results.length) {
    return <ResultMessage value={t("No matching capabilities found.")} />;
  }
  return (
    <>
      {results.map((item) => (
        <div
          className="finance-result-card"
          key={String(item.tool_id ?? item.name ?? "capability")}
        >
          <strong>
            {String(item.name || item.capability || item.tool_id || t("Unknown capability"))}
          </strong>
          <span>
            {[item.provider_name, item.expected_cost || item.cost_class].filter(Boolean).join(" · ")}
          </span>
          <code>{String(item.tool_id || "")}</code>
        </div>
      ))}
      <CopyResultButton response={response} />
    </>
  );
}

function SnapshotsResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Could not load snapshots.")} />;
  }
  const snapshots = asArray(result.data?.snapshots);
  if (!snapshots.length) {
    return <ResultMessage value={t("No market data snapshots yet.")} />;
  }
  return (
    <>
      {snapshots.map((snapshot) => (
        <div
          className="finance-result-card"
          key={String(snapshot.kind ?? snapshot.symbol ?? "snapshot")}
        >
          <strong>{[snapshot.kind, snapshot.symbol].filter(Boolean).join(" · ")}</strong>
          <span>
            {[snapshot.asOf, record(snapshot.source).provider, record(snapshot.source).executionId]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      ))}
      <CopyResultButton response={response} />
    </>
  );
}

function BacktestResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Backtest failed.")} />;
  }
  const metrics = result.data?.metrics as Record<string, unknown> | undefined;
  if (!metrics) {
    return <ResultMessage value={t("Backtest returned no metrics.")} />;
  }
  return (
    <>
      <MetricGrid
        entries={[
          [t("Total return"), metrics.totalReturn],
          [t("CAGR"), metrics.cagr],
          [t("Maximum drawdown"), metrics.maxDrawdown],
          [t("Sharpe ratio"), metrics.sharpeRatio],
          [t("Final equity"), metrics.finalEquity],
          [t("Completed trades"), metrics.completedTrades],
        ]}
        percentLabels={[t("Total return"), t("CAGR"), t("Maximum drawdown")]}
      />
      <CopyResultButton response={response} />
    </>
  );
}

function UsageResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Could not load usage audit.")} />;
  }
  const usageData = ((result.data?.usage as Record<string, unknown>)?.data ?? {}) as Record<
    string,
    unknown
  >;
  const ledgerData = ((result.data?.ledger as Record<string, unknown>)?.data ?? {}) as Record<
    string,
    unknown
  >;
  const latestLedger = asArray(ledgerData.items)[0] as
    | { balance_after?: { total_available_credits?: unknown } }
    | undefined;
  const summary = (usageData.summary ?? {}) as Record<string, unknown>;
  return (
    <>
      <MetricGrid
        entries={[
          [t("Recent requests"), summary.total_count ?? usageData.total],
          [t("Settled credits"), summary.settled_credits],
          [t("Available credits"), latestLedger?.balance_after?.total_available_credits],
          [t("Audit samples"), asArray(usageData.items).length],
        ]}
      />
      <CopyResultButton response={response} />
    </>
  );
}

function ScreeningResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Screening failed.")} />;
  }
  const results = asArray(result.data?.results);
  if (!results.length) {
    return <ResultMessage value={t("No screening candidates returned.")} />;
  }
  return (
    <>
      {results.map((candidate) => (
        <div className="finance-ranking-row" key={String(candidate.symbol ?? "candidate")}>
          <strong>#{String(candidate.rank)}</strong>
          <div>
            <strong>{String(candidate.symbol || "—")}</strong>
            <span>
              {t("Coverage")} {percent(candidate.coverage)}
            </span>
          </div>
          <code>{number(candidate.score)}</code>
        </div>
      ))}
      <CopyResultButton response={response} />
    </>
  );
}

function ResearchSection({
  label,
  value,
  tone = "",
}: {
  label: string;
  value?: unknown;
  tone?: string;
}) {
  if (!value) return null;
  return (
    <section className={`finance-research-evidence${tone ? ` tone-${tone}` : ""}`}>
      <strong>{label}</strong>
      <p>{String(value)}</p>
    </section>
  );
}

function ResearchResults({
  response,
  controller,
}: {
  response: unknown;
  controller: FinanceWorkbenchController;
}) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Could not load research workspace")} />;
  }
  const cards = asArray(result.data?.cards);
  if (!cards.length) {
    return <ResultMessage value={t("No research cards yet")} />;
  }
  const upcoming = cards
    .filter((card) => card.eventAt && new Date(String(card.eventAt)).getTime() >= Date.now())
    .sort((left, right) => String(left.eventAt).localeCompare(String(right.eventAt)));
  return (
    <>
      {upcoming.length > 0 ? (
        <section className="finance-event-calendar">
          <h4>{t("Upcoming events")}</h4>
          {upcoming.slice(0, 10).map((card) => (
            <div className="finance-event-row" key={`event-${card.id ?? card.symbol}`}>
              <time dateTime={String(card.eventAt)}>
                {new Date(String(card.eventAt)).toLocaleString()}
              </time>
              <strong>
                {String(card.symbol)} · {String(card.title)}
              </strong>
            </div>
          ))}
        </section>
      ) : null}
      <div className="finance-research-list">
        {cards.map((card) => (
          <article className="finance-research-card" key={`card-${card.id}`}>
            <header>
              <div>
                <span className="ui-badge">{String(card.symbol)}</span>
                <h4>{String(card.title || card.symbol)}</h4>
              </div>
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => controller.removeResearchCard(String(card.id))}
              >
                {t("Remove")}
              </button>
            </header>
            <ResearchSection label={t("Thesis")} value={card.thesis} />
            <div className="finance-research-cases">
              <ResearchSection label={t("Bull case")} value={card.bullCase} tone="positive" />
              <ResearchSection label={t("Bear case")} value={card.bearCase} tone="negative" />
            </div>
            <ResearchSection
              label={t("Invalidation")}
              value={card.invalidation}
              tone="warning"
            />
            {asArray(card.sources).length > 0 ? (
              <ResearchSection
                label={t("Sources")}
                value={asArray(card.sources).join("\n")}
              />
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}

function PaperAccountsResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Could not load paper accounts.")} />;
  }
  const accounts = asArray(result.data?.accounts);
  if (!accounts.length) {
    return <ResultMessage value={t("No paper accounts yet.")} />;
  }
  return (
    <>
      {accounts.map((account) => (
        <div className="finance-paper-account" key={String(account.id)}>
          <strong>{String(account.name || account.id)}</strong>
          <span>
            {`${account.baseCurrency || ""} · ${t("Cash")} ${number(account.cash)} · ${t(
              "Positions",
            )} ${number(account.positionCount)}`}
          </span>
          <code>{String(account.id)}</code>
        </div>
      ))}
    </>
  );
}

function LimitOrderResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Could not manage limit order.")} />;
  }
  const orders = asArray(result.data?.processed).length
    ? asArray(result.data?.processed)
    : result.data?.order
      ? [result.data.order as Record<string, unknown>]
      : [];
  if (!orders.length) {
    return <ResultMessage value={t("No pending orders were triggered.")} />;
  }
  return (
    <>
      {orders.map((order) => (
        <div className="finance-result-card" key={String(order.id ?? "order")}>
          <strong>{`${t(String(order.side || ""))} ${order.symbol || ""} × ${number(order.quantity)}`}</strong>
          <span>
            {[order.status, order.limitPrice ? `@ ${number(order.limitPrice)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <code>{String(order.id || "")}</code>
        </div>
      ))}
    </>
  );
}

function PortfolioMarkResults({ response }: { response: unknown }) {
  const result = (response ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  if (!result?.ok) {
    return <ResultMessage value={result?.error || t("Could not mark portfolio.")} />;
  }
  const data = (result.data ?? {}) as Record<string, unknown>;
  const risk = (data.risk ?? {}) as Record<string, unknown>;
  const largest = (risk.largestPosition ?? {}) as Record<string, unknown>;
  const percentLabels = [t("Gross exposure"), t("Largest position weight")];
  return (
    <MetricGrid
      entries={[
        [t("Portfolio equity"), data.equity],
        [t("Market value"), data.marketValue],
        [t("Unrealized P&L"), data.unrealizedPnl],
        [t("Missing quotes"), asArray(data.missingSymbols).length],
        [t("Gross exposure"), risk.grossExposure],
        [t("Concentration HHI"), risk.concentrationHhi],
        [t("Largest position weight"), largest.weight],
        [t("Stale positions"), risk.stalePositionCount],
      ]}
      percentLabels={percentLabels}
    />
  );
}

function JsonForm({
  busy,
  sample,
  submitLabel,
  value,
  onChange,
  placeholder,
  onSubmit,
}: {
  busy: boolean;
  sample?: unknown;
  submitLabel: string;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  onSubmit(input: string): void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const insertSample = () => {
    if (sample === undefined) return;
    onChange(JSON.stringify(sample, null, 2));
    textareaRef.current?.focus();
  };
  const clearInput = () => {
    onChange("");
    textareaRef.current?.focus();
  };
  const formatInput = () => {
    try {
      const parsed = JSON.parse(value);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        onChange(JSON.stringify(parsed, null, 2));
        textareaRef.current?.focus();
      }
    } catch {
      // Invalid JSON is left as-is; the inline error already reports it.
    }
  };
  const jsonError = useMemo(() => {
    const text = value.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return t("Must be a JSON object");
      }
      return null;
    } catch (error) {
      if (error instanceof SyntaxError) {
        const position = Number(error.message.match(/position (\d+)/)?.[1]);
        if (Number.isFinite(position)) {
          const before = text.slice(0, position);
          const lines = before.split("\n");
          const line = lines.length;
          const column = lines[lines.length - 1].length + 1;
          return t("Invalid JSON at line {line}, column {column}")
            .replace("{line}", String(line))
            .replace("{column}", String(column));
        }
        return t("Invalid JSON");
      }
      return error instanceof Error ? error.message : String(error);
    }
  }, [value]);
  return (
    <form
      className="finance-form"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <textarea
        ref={textareaRef}
        className="ui-textarea"
        placeholder={placeholder}
        aria-label={t("JSON input")}
        rows={5}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        disabled={busy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {jsonError ? (
        <p className="finance-json-error" role="status">
          ✗ {jsonError}
        </p>
      ) : value.trim() ? (
        <p className="finance-json-ok" role="status">
          ✓ {t("Valid JSON")}
        </p>
      ) : null}
      <div className="finance-form-actions">
        {sample !== undefined ? (
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            onClick={insertSample}
            disabled={busy}
          >
            {t("Insert sample")}
          </button>
        ) : null}
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          onClick={clearInput}
          disabled={busy || !value.trim()}
        >
          {t("Clear")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          onClick={formatInput}
          disabled={busy || !value.trim() || Boolean(jsonError)}
        >
          {t("Format JSON")}
        </button>
        <button
          type="submit"
          className="ui-button ui-button--primary"
          disabled={busy}
          aria-busy={busy}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function OverviewView({
  store,
  controller,
}: {
  store: FinanceWorkbenchStoreHook;
  controller: FinanceWorkbenchController;
}) {
  const status = store((state) => state.status);
  const usage = store((state) => state.usage);
  const busy = store((state) => state.busy);
  const statusText =
    status?.state === "connected"
      ? t("Connected")
      : status?.state === "missing"
        ? t("Key required")
        : status?.state === "unavailable"
          ? t("Unavailable")
          : t("Checking…");
  return (
    <section
      className="ui-card finance-status-card finance-plugin-section"
      data-finance-view="overview"
    >
      <div className="finance-section-heading">
        <h3>{t("QVeris financial data")}</h3>
        <p>{t("Live and historical capabilities")}</p>
      </div>
      <div className="finance-form-actions">
        <span className="finance-status" data-status={status?.state ?? "checking"}>
          {statusText}
        </span>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          onClick={() => controller.runUsage()}
          disabled={Boolean(busy.usage)}
        >
          {t("Usage & credits")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          onClick={() => controller.openConfiguration()}
        >
          {t("Configure data key")}
        </button>
      </div>
      {usage ? <UsageResults response={usage} /> : null}
    </section>
  );
}

function SectionShell({
  view,
  descriptionKey,
  children,
}: {
  view: FinanceViewDefinition;
  descriptionKey: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="ui-card finance-plugin-section"
      data-finance-view={view.id}
    >
      <div className="finance-section-heading">
        <h3>{financeViewLabel(view)}</h3>
        <p>{t(descriptionKey)}</p>
      </div>
      {children}
    </section>
  );
}

export function FinanceNavApp({
  store,
  controller,
}: {
  store: FinanceWorkbenchStoreHook;
  controller: FinanceWorkbenchController;
}) {
  const activeViewId = store((state) => state.activeViewId);
  const sceneId = store((state) => state.sceneId);
  const financeScene = sceneId === "finance";
  return (
    <>
      {["Data", "Analysis", "Research", "Accounts"].map((group) => {
        const groupViews = FINANCE_VIEWS.filter((view) => view.group === group);
        if (!groupViews.length) return null;
        return (
          <details className="finance-nav-section" open key={group}>
            <summary>{financeGroupLabel(group)}</summary>
            <div className="finance-nav-section-body">
              {groupViews.map((view) => (
                <button
                  type="button"
                  className={`finance-nav-item${activeViewId === view.id ? " active" : ""}`}
                  aria-pressed={activeViewId === view.id}
                  disabled={!financeScene}
                  key={view.id}
                  onClick={() => controller.selectView(view.id)}
                >
                  {financeViewLabel(view)}
                </button>
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}

export function FinanceContentApp({
  store,
  controller,
}: {
  store: FinanceWorkbenchStoreHook;
  controller: FinanceWorkbenchController;
}) {
  const activeViewId = store((state) => state.activeViewId);
  const sceneId = store((state) => state.sceneId);
  const discovery = store((state) => state.discovery);
  const snapshots = store((state) => state.snapshots);
  const snapshotSaved = store((state) => state.snapshotSaved);
  const backtest = store((state) => state.backtest);
  const screening = store((state) => state.screening);
  const research = store((state) => state.research);
  const paperAccounts = store((state) => state.paperAccounts);
  const paperOrder = store((state) => state.paperOrder);
  const paperLimit = store((state) => state.paperLimit);
  const paperMark = store((state) => state.paperMark);
  const busy = store((state) => state.busy);
  const jsonInputs = store((state) => state.inputs);
  const inputValue = (key: string) => jsonInputs[key] ?? "";
  const setInputValue = (key: string, value: string) =>
    store.setState((state) => ({ inputs: { ...state.inputs, [key]: value } }));
  const [creatingSession, setCreatingSession] = useState(false);


  if (sceneId !== "finance") {
    return (
      <section className="finance-scene-guard ui-card">
        <h1>{t("Finance requires a Finance scene")}</h1>
        <p>
          {t(
            "Select the Finance scene below, then start a new session to open the Finance workbench. Data, credentials, tools, and ledgers stay isolated per scene.",
          )}
        </p>
        <div className="finance-scene-guard-actions">
          <button
            type="button"
            className="ui-button ui-button--primary"
            disabled={creatingSession}
            aria-busy={creatingSession}
            onClick={async () => {
              setCreatingSession(true);
              try {
                await controller.createFinanceSession();
              } finally {
                setCreatingSession(false);
              }
            }}
          >
            {creatingSession ? t("Starting session…") : t("New Finance session")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => controller.openSceneSettings()}
          >
            {t("Select finance scene")}
          </button>
        </div>
      </section>
    );
  }

  switch (activeViewId) {
    case "overview":
      return <OverviewView store={store} controller={controller} />;
    case "discovery":
      return (
        <SectionShell view={FINANCE_VIEWS[1]} descriptionKey="Discover is free; inspect cost before calling.">
          <form
            className="finance-form"
            aria-busy={Boolean(busy.discovery)}
            onSubmit={(event) => {
              event.preventDefault();
              controller.runDiscovery(inputValue("discovery"));
            }}
          >
            <input
              className="ui-input"
              disabled={Boolean(busy.discovery)}
              placeholder={t("historical daily adjusted equity prices and company fundamentals")}
              value={inputValue("discovery")}
              onChange={(event) => setInputValue("discovery", event.target.value)}
            />
            <div className="finance-form-actions">
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                disabled={Boolean(busy.discovery) || !inputValue("discovery").trim()}
                onClick={() => setInputValue("discovery", "")}
              >
                {t("Clear")}
              </button>
              <button type="submit" className="ui-button ui-button--primary" disabled={Boolean(busy.discovery)} aria-busy={Boolean(busy.discovery)}>
                {t("Discover")}
              </button>
            </div>
          </form>
          {discovery ? <DiscoveryResults response={discovery} /> : null}
        </SectionShell>
      );
    case "snapshots":
      return (
        <SectionShell
          view={FINANCE_VIEWS[2]}
          descriptionKey="Preserve as-of time, currency and QVeris execution provenance."
        >
          <JsonForm
            busy={Boolean(busy.snapshot)}
            sample={sampleSnapshot()}
            submitLabel={t("Save snapshot")}
            value={inputValue("snapshot")}
            onChange={(value) => setInputValue("snapshot", value)}
            placeholder='{"kind":"quote","symbol":"600519.SH","currency":"CNY","asOf":"...","source":{"provider":"QVeris","executionId":"exec_..."},"payload":{"price":1400}}'
            onSubmit={(input) => controller.saveSnapshot(input)}
          />
          <div className="finance-form-actions">
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => controller.listSnapshots()}
              disabled={Boolean(busy.snapshot)}
            >
              {t("Recent snapshots")}
            </button>
          </div>
          {snapshotSaved ? <ResultMessage value={snapshotSaved as string} /> : null}
          {snapshots ? <SnapshotsResults response={snapshots} /> : null}
        </SectionShell>
      );
    case "backtest":
      return (
        <SectionShell
          view={FINANCE_VIEWS[3]}
          descriptionKey="Deterministic next-bar execution with fees and slippage."
        >
          <JsonForm
            busy={Boolean(busy.backtest)}
            sample={sampleBacktest()}
            submitLabel={t("Run backtest")}
            value={inputValue("backtest")}
            onChange={(value) => setInputValue("backtest", value)}
            placeholder='{"bars":[...],"strategy":{"type":"sma_crossover","fastPeriod":20,"slowPeriod":60}}'
            onSubmit={(input) => controller.runBacktest(input)}
          />
          {backtest ? <BacktestResults response={backtest} /> : null}
        </SectionShell>
      );
    case "screening":
      return (
        <SectionShell
          view={FINANCE_VIEWS[4]}
          descriptionKey="Explainable local ranking with missing-data coverage."
        >
          <JsonForm
            busy={Boolean(busy.screening)}
            sample={sampleScreening()}
            submitLabel={t("Rank candidates")}
            value={inputValue("screening")}
            onChange={(value) => setInputValue("screening", value)}
            placeholder='{"securities":[...],"factors":[...]}'
            onSubmit={(input) => controller.runScreening(input)}
          />
          {screening ? <ScreeningResults response={screening} /> : null}
        </SectionShell>
      );
    case "research":
      return (
        <SectionShell
          view={FINANCE_VIEWS[5]}
          descriptionKey="Watchlist, evidence, invalidation rules and upcoming events."
        >
          <div className="finance-form-actions">
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => controller.refreshResearch()}
              disabled={Boolean(busy.research)}
            >
              {t("Refresh")}
            </button>
          </div>
          <form
            className="finance-form"
            aria-busy={Boolean(busy.research)}
            onSubmit={(event) => {
              event.preventDefault();
              controller.saveResearchCard({
                symbol: inputValue("researchSymbol"),
                title: inputValue("researchTitle"),
                eventAt: inputValue("researchEvent")
                  ? new Date(inputValue("researchEvent")).toISOString()
                  : null,
                thesis: inputValue("researchThesis"),
                bullCase: inputValue("researchBull"),
                bearCase: inputValue("researchBear"),
                invalidation: inputValue("researchInvalidation"),
                sources: inputValue("researchSources").split(/\r?\n/),
              });
            }}
          >
            <input
              className="ui-input"
              placeholder={t("Symbol")}
              required
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={Boolean(busy.research)}
              value={inputValue("researchSymbol")}
              onChange={(event) => setInputValue("researchSymbol", event.target.value)}
            />
            <input
              className="ui-input"
              placeholder={t("Research title")}
              disabled={Boolean(busy.research)}
              value={inputValue("researchTitle")}
              onChange={(event) => setInputValue("researchTitle", event.target.value)}
            />
            <input
              className="ui-input"
              type="datetime-local"
              aria-label={t("Upcoming event")}
              disabled={Boolean(busy.research)}
              value={inputValue("researchEvent")}
              onChange={(event) => setInputValue("researchEvent", event.target.value)}
            />
            <textarea
              className="ui-textarea"
              rows={3}
              placeholder={t("Investment thesis")}
              required
              disabled={Boolean(busy.research)}
              value={inputValue("researchThesis")}
              onChange={(event) => setInputValue("researchThesis", event.target.value)}
            />
            <textarea
              className="ui-textarea"
              rows={4}
              placeholder={t("Bull case and supporting evidence")}
              disabled={Boolean(busy.research)}
              value={inputValue("researchBull")}
              onChange={(event) => setInputValue("researchBull", event.target.value)}
            />
            <textarea
              className="ui-textarea"
              rows={4}
              placeholder={t("Bear case and counter-evidence")}
              disabled={Boolean(busy.research)}
              value={inputValue("researchBear")}
              onChange={(event) => setInputValue("researchBear", event.target.value)}
            />
            <textarea
              className="ui-textarea"
              rows={3}
              placeholder={t("What would invalidate the thesis?")}
              disabled={Boolean(busy.research)}
              value={inputValue("researchInvalidation")}
              onChange={(event) => setInputValue("researchInvalidation", event.target.value)}
            />
            <textarea
              className="ui-textarea"
              rows={3}
              placeholder={t("Source URLs or execution IDs, one per line")}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={Boolean(busy.research)}
              value={inputValue("researchSources")}
              onChange={(event) => setInputValue("researchSources", event.target.value)}
            />
            <div className="finance-form-actions">
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                disabled={Boolean(busy.research)}
                onClick={() => {
                  for (const key of [
                    "researchSymbol",
                    "researchTitle",
                    "researchEvent",
                    "researchThesis",
                    "researchBull",
                    "researchBear",
                    "researchInvalidation",
                    "researchSources",
                  ]) {
                    setInputValue(key, "");
                  }
                }}
              >
                {t("Clear")}
              </button>
              <button type="submit" className="ui-button ui-button--primary" disabled={Boolean(busy.research)} aria-busy={Boolean(busy.research)}>
                {t("Save research card")}
              </button>
            </div>
          </form>
          {research ? <ResearchResults response={research} controller={controller} /> : null}
        </SectionShell>
      );
    case "paper":
      return (
        <SectionShell
          view={FINANCE_VIEWS[6]}
          descriptionKey="Isolated simulation ledger; never sends real orders."
        >
          <div className="finance-form-actions">
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => controller.refreshPaperAccounts()}
              disabled={Boolean(busy.paper)}
            >
              {t("Refresh")}
            </button>
          </div>
          <form
            className="finance-form"
            aria-busy={Boolean(busy.paperAccount)}
            onSubmit={(event) => {
              event.preventDefault();
              controller.createPaperAccount({
                name: inputValue("paperName").trim(),
                baseCurrency: (inputValue("paperCurrency") || "CNY").trim(),
                initialCash: Number(inputValue("paperCash")),
              });
            }}
          >
            <input
              className="ui-input"
              placeholder={t("Account name")}
              required
              disabled={Boolean(busy.paperAccount)}
              value={inputValue("paperName")}
              onChange={(event) => setInputValue("paperName", event.target.value)}
            />
            <input
              className="ui-input"
              disabled={Boolean(busy.paperAccount)}
              value={inputValue("paperCurrency") || "CNY"}
              onChange={(event) => setInputValue("paperCurrency", event.target.value)}
            />
            <input
              className="ui-input"
              type="number"
              min="0"
              required
              disabled={Boolean(busy.paperAccount)}
              value={inputValue("paperCash")}
              onChange={(event) => setInputValue("paperCash", event.target.value)}
            />
            <div className="finance-form-actions">
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                disabled={Boolean(busy.paperAccount)}
                onClick={() => {
                  for (const key of ["paperName", "paperCurrency", "paperCash"]) {
                    setInputValue(key, "");
                  }
                }}
              >
                {t("Clear")}
              </button>
              <button type="submit" className="ui-button ui-button--primary" disabled={Boolean(busy.paperAccount)} aria-busy={Boolean(busy.paperAccount)}>
                {t("Create account")}
              </button>
            </div>
          </form>
          {paperAccounts ? <PaperAccountsResults response={paperAccounts} /> : null}
          <JsonForm
            busy={Boolean(busy.paperOrder)}
            sample={samplePaperOrder()}
            submitLabel={t("Record simulated order")}
            value={inputValue("paperOrder")}
            onChange={(value) => setInputValue("paperOrder", value)}
            placeholder='{"accountId":"...","symbol":"600519.SH","side":"buy","quantity":100,"snapshot":{"price":1400,"asOf":"2026-07-30T07:00:00Z","source":"QVeris execution id"}}'
            onSubmit={(input) => controller.recordPaperOrder(input)}
          />
          {paperOrder ? <ResultMessage value={paperOrder as string} /> : null}
          <JsonForm
            busy={Boolean(busy.paperLimit)}
            sample={samplePaperLimit()}
            submitLabel={t("Manage limit order")}
            value={inputValue("paperLimit")}
            onChange={(value) => setInputValue("paperLimit", value)}
            placeholder='{"action":"place","accountId":"...","symbol":"600519.SH","side":"buy","quantity":100,"limitPrice":1380,"currency":"CNY"}'
            onSubmit={(input) => controller.manageLimitOrder(input)}
          />
          {paperLimit ? <LimitOrderResults response={paperLimit} /> : null}
          <JsonForm
            busy={Boolean(busy.paperMark)}
            sample={samplePaperMark()}
            submitLabel={t("Mark portfolio")}
            value={inputValue("paperMark")}
            onChange={(value) => setInputValue("paperMark", value)}
            placeholder='{"accountId":"...","quotes":[{"symbol":"600519.SH","price":1410,"asOf":"...","source":"QVeris exec_...","currency":"CNY"}]}'
            onSubmit={(input) => controller.markPortfolio(input)}
          />
          {paperMark ? <PortfolioMarkResults response={paperMark} /> : null}
        </SectionShell>
      );
    default:
      return null;
  }
}
