import { t } from "../../i18n.js";

export function setupFinanceWorkbench({
  configGateway,
  getTarget,
  openConfiguration,
  openFinanceApp = () => {},
  artifactGateway = null,
  notify = () => {},
} = {}) {
  const button = document.getElementById("finance-workbench-btn");
  const panel = document.getElementById("finance-workbench");
  if (!panel || !configGateway) return null;
  const close = document.getElementById("finance-workbench-close");
  const status = document.getElementById("finance-qveris-status");
  const configure = document.getElementById("finance-open-configuration");
  const usageButton = document.getElementById("finance-qveris-usage");
  const usageResults = document.getElementById("finance-qveris-usage-results");
  const discoveryForm = document.getElementById("finance-discovery-form");
  const discoveryQuery = document.getElementById("finance-discovery-query");
  const discoveryResults = document.getElementById("finance-discovery-results");
  const snapshotForm = document.getElementById("finance-snapshot-form");
  const snapshotInput = document.getElementById("finance-snapshot-input");
  const snapshotSample = document.getElementById("finance-snapshot-sample");
  const snapshotList = document.getElementById("finance-snapshot-list");
  const snapshotResults = document.getElementById("finance-snapshot-results");
  const backtestForm = document.getElementById("finance-backtest-form");
  const backtestInput = document.getElementById("finance-backtest-input");
  const backtestSample = document.getElementById("finance-backtest-sample");
  const backtestResults = document.getElementById("finance-backtest-results");
  const screenForm = document.getElementById("finance-screen-form");
  const screenInput = document.getElementById("finance-screen-input");
  const screenSample = document.getElementById("finance-screen-sample");
  const screenResults = document.getElementById("finance-screen-results");
  const paperRefresh = document.getElementById("finance-paper-refresh");
  const paperAccountForm = document.getElementById("finance-paper-account-form");
  const paperAccountName = document.getElementById("finance-paper-account-name");
  const paperAccountCurrency = document.getElementById("finance-paper-account-currency");
  const paperAccountCash = document.getElementById("finance-paper-account-cash");
  const paperAccounts = document.getElementById("finance-paper-accounts");
  const paperOrderForm = document.getElementById("finance-paper-order-form");
  const paperOrderInput = document.getElementById("finance-paper-order-input");
  const paperOrderResults = document.getElementById("finance-paper-order-results");
  const paperLimitForm = document.getElementById("finance-paper-limit-form");
  const paperLimitInput = document.getElementById("finance-paper-limit-input");
  const paperLimitResults = document.getElementById("finance-paper-limit-results");
  const paperMarkForm = document.getElementById("finance-paper-mark-form");
  const paperMarkInput = document.getElementById("finance-paper-mark-input");
  const paperMarkResults = document.getElementById("finance-paper-mark-results");
  const researchRefresh = document.getElementById("finance-research-refresh");
  const researchForm = document.getElementById("finance-research-form");
  const researchSymbol = document.getElementById("finance-research-symbol");
  const researchTitle = document.getElementById("finance-research-title");
  const researchEvent = document.getElementById("finance-research-event");
  const researchThesis = document.getElementById("finance-research-thesis");
  const researchBull = document.getElementById("finance-research-bull");
  const researchBear = document.getElementById("finance-research-bear");
  const researchInvalidation = document.getElementById("finance-research-invalidation");
  const researchSources = document.getElementById("finance-research-sources");
  const researchResults = document.getElementById("finance-research-results");
  const sourceBody = panel.querySelector(".finance-workbench-body");
  const sections = [...(sourceBody?.querySelectorAll(":scope > section") ?? [])];
  const views = [
    { id: "overview", label: "Overview", group: "Data", section: sections[0] },
    { id: "discovery", label: "Capability discovery", group: "Data", section: sections[1] },
    { id: "snapshots", label: "Market data snapshots", group: "Data", section: sections[2] },
    { id: "backtest", label: "Strategy backtest", group: "Analysis", section: sections[3] },
    { id: "screening", label: "Multi-factor screener", group: "Analysis", section: sections[4] },
    { id: "research", label: "Research workspace", group: "Research", section: sections[6] },
    { id: "paper", label: "Paper trading", group: "Accounts", section: sections[5] },
  ].filter((view) => view.section);
  let navigationContainer = null;
  let contentContainer = null;
  let activeViewId = "overview";
  for (const view of views) {
    view.section.classList.add("finance-plugin-section");
    view.section.dataset.financeView = view.id;
  }
  panel.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");

  function setTarget() {
    renderNavigation(navigationContainer);
    renderContent(contentContainer);
  }

  async function loadStatus() {
    status.textContent = t("Checking…");
    const result = await configGateway.call("finance_status").catch((error) => ({
      ok: false,
      error: error?.message || String(error),
    }));
    if (!result?.ok) {
      status.textContent = t("Unavailable");
      status.title = result?.error || "";
      return;
    }
    const configured = result.data?.qveris?.configured === true;
    status.textContent = t(configured ? "Connected" : "Key required");
    status.dataset.status = configured ? "connected" : "missing";
  }

  async function openPanel(viewId = "overview") {
    selectView(viewId);
    openFinanceApp();
    await loadStatus();
    await loadPaperAccounts();
    await loadResearchWorkspace();
  }

  button?.addEventListener("click", () => void openPanel());
  close?.addEventListener("click", () => {});
  configure?.addEventListener("click", () => openConfiguration?.());
  usageButton?.addEventListener("click", async () => {
    usageButton.disabled = true;
    usageResults.replaceChildren(message(t("Loading usage audit…")));
    const result = await configGateway
      .call("finance_qveris_usage", { limit: 10 }, { timeoutMs: 60_000 })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    usageButton.disabled = false;
    renderUsage(usageResults, result);
  });

  discoveryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(discoveryForm, true);
    discoveryResults.replaceChildren(message(t("Discovering capabilities…")));
    const result = await configGateway
      .call(
        "finance_discover",
        { query: discoveryQuery.value.trim(), limit: 8 },
        { timeoutMs: 60_000 },
      )
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(discoveryForm, false);
    renderDiscovery(discoveryResults, result);
  });

  snapshotSample?.addEventListener("click", () => {
    snapshotInput.value = JSON.stringify(sampleSnapshot(), null, 2);
  });
  snapshotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const snapshot = parseJsonInput(
      snapshotInput,
      snapshotResults,
      "Snapshot input must be valid JSON.",
    );
    if (!snapshot) return;
    setBusy(snapshotForm, true);
    const result = await configGateway
      .call("finance_market_data", { action: "save", snapshot })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(snapshotForm, false);
    snapshotResults.replaceChildren(
      message(result?.ok ? t("Snapshot saved.") : result?.error || t("Could not save snapshot.")),
    );
    if (result?.ok) {
      await recordArtifact({
        kind: "dataset",
        title: [t("Market data snapshot"), snapshot.symbol || snapshot.kind]
          .filter(Boolean)
          .join(" · "),
        summary: t("Saved market data with its as-of time and execution provenance."),
        provenance: {
          engine: "finance.market-data",
          source: snapshot.source ?? {},
          asOf: snapshot.asOf ?? null,
        },
        content: { snapshot, result: result.data ?? null },
      });
    }
  });
  snapshotList?.addEventListener("click", async () => {
    snapshotList.disabled = true;
    const result = await configGateway
      .call("finance_market_data", { action: "list", limit: 10 })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    snapshotList.disabled = false;
    renderSnapshots(snapshotResults, result);
  });

  backtestSample?.addEventListener("click", () => {
    backtestInput.value = JSON.stringify(sampleBacktest(), null, 2);
  });
  backtestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    let input;
    try {
      input = JSON.parse(backtestInput.value);
    } catch {
      backtestResults.replaceChildren(message(t("Backtest input must be valid JSON.")));
      return;
    }
    setBusy(backtestForm, true);
    backtestResults.replaceChildren(message(t("Running backtest…")));
    const result = await configGateway
      .call("finance_backtest", { input }, { timeoutMs: 60_000 })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(backtestForm, false);
    renderBacktest(backtestResults, result);
    if (result?.ok) {
      await recordArtifact({
        kind: "report",
        title: `${t("Strategy backtest")} · ${shortTimestamp()}`,
        summary: t("Deterministic local backtest result with its complete input."),
        provenance: { engine: "finance.backtest.local", deterministic: true },
        content: { input, result: result.data ?? null },
      });
    }
  });

  screenSample?.addEventListener("click", () => {
    screenInput.value = JSON.stringify(sampleScreening(), null, 2);
  });
  screenForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = parseJsonInput(screenInput, screenResults, "Screening input must be valid JSON.");
    if (!input) return;
    setBusy(screenForm, true);
    screenResults.replaceChildren(message(t("Ranking candidates…")));
    const result = await configGateway
      .call("finance_screen", { input }, { timeoutMs: 60_000 })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(screenForm, false);
    renderScreening(screenResults, result);
    if (result?.ok) {
      await recordArtifact({
        kind: "report",
        title: `${t("Multi-factor screener")} · ${shortTimestamp()}`,
        summary: t("Explainable local ranking with its complete factor input."),
        provenance: { engine: "finance.screen.local", deterministic: true },
        content: { input, result: result.data ?? null },
      });
    }
  });

  async function recordArtifact(artifact) {
    if (!artifactGateway) return;
    try {
      await artifactGateway.create(getTarget?.()?.sceneId ?? "finance", {
        pluginId: "com.zicode.finance",
        mimeType: "application/json",
        ...artifact,
      });
      notify(t("Added to Artifacts"));
    } catch {
      notify(t("Result was shown but could not be added to Artifacts"));
    }
  }

  async function loadPaperAccounts() {
    if (!paperAccounts) return;
    paperAccounts.replaceChildren(message(t("Loading paper accounts…")));
    const result = await configGateway
      .call("finance_paper_accounts", { action: "list" })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    renderPaperAccounts(paperAccounts, result);
  }

  async function loadResearchWorkspace() {
    if (!researchResults) return;
    researchResults.replaceChildren(message(t("Loading research workspace…")));
    const result = await configGateway
      .call("finance_research_workspace", { action: "list" })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    renderResearchWorkspace(researchResults, result, async (id) => {
      const removed = await configGateway
        .call("finance_research_workspace", { action: "remove", id })
        .catch((error) => ({ ok: false, error: error?.message || String(error) }));
      if (!removed?.ok) {
        notify({ title: t("Could not remove research card"), message: removed?.error, type: "error" });
        return;
      }
      await loadResearchWorkspace();
    });
  }

  researchRefresh?.addEventListener("click", () => void loadResearchWorkspace());
  researchForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(researchForm, true);
    const result = await configGateway
      .call("finance_research_workspace", {
        action: "upsert",
        card: {
          symbol: researchSymbol.value,
          title: researchTitle.value,
          eventAt: researchEvent.value ? new Date(researchEvent.value).toISOString() : null,
          thesis: researchThesis.value,
          bullCase: researchBull.value,
          bearCase: researchBear.value,
          invalidation: researchInvalidation.value,
          sources: researchSources.value.split(/\r?\n/),
        },
      })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(researchForm, false);
    if (!result?.ok) {
      researchResults.replaceChildren(message(result?.error || t("Could not save research card")));
      return;
    }
    researchForm.reset();
    notify({ title: t("Research card saved"), type: "success" });
    await loadResearchWorkspace();
  });

  paperRefresh?.addEventListener("click", () => void loadPaperAccounts());
  paperAccountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(paperAccountForm, true);
    const result = await configGateway
      .call("finance_paper_accounts", {
        action: "create",
        name: paperAccountName.value.trim(),
        baseCurrency: paperAccountCurrency.value.trim(),
        initialCash: Number(paperAccountCash.value),
      })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(paperAccountForm, false);
    if (!result?.ok) {
      paperAccounts.replaceChildren(message(result?.error || t("Could not create paper account.")));
      return;
    }
    await loadPaperAccounts();
  });

  paperOrderForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = parseJsonInput(
      paperOrderInput,
      paperOrderResults,
      "Paper order input must be valid JSON.",
    );
    if (!input) return;
    setBusy(paperOrderForm, true);
    paperOrderResults.replaceChildren(message(t("Recording simulated order…")));
    const result = await configGateway
      .call("finance_paper_order", { input })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(paperOrderForm, false);
    if (!result?.ok) {
      paperOrderResults.replaceChildren(
        message(result?.error || t("Could not record simulated order.")),
      );
      return;
    }
    paperOrderResults.replaceChildren(message(t("Simulated order recorded.")));
    await loadPaperAccounts();
  });
  paperLimitForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = parseJsonInput(
      paperLimitInput,
      paperLimitResults,
      "Limit order input must be valid JSON.",
    );
    if (!input) return;
    setBusy(paperLimitForm, true);
    const result = await configGateway
      .call("finance_paper_limit_order", input)
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(paperLimitForm, false);
    renderLimitOrder(paperLimitResults, result);
    if (result?.ok) await loadPaperAccounts();
  });
  paperMarkForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = parseJsonInput(
      paperMarkInput,
      paperMarkResults,
      "Portfolio quotes must be valid JSON.",
    );
    if (!input) return;
    setBusy(paperMarkForm, true);
    const result = await configGateway
      .call("finance_paper_accounts", { action: "mark", ...input })
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    setBusy(paperMarkForm, false);
    renderPortfolioMark(paperMarkResults, result);
  });

  function selectView(viewId) {
    if (views.some((view) => view.id === viewId)) activeViewId = viewId;
    renderNavigation(navigationContainer);
    renderContent(contentContainer);
    if (activeViewId === "overview") void loadStatus();
    if (activeViewId === "paper") void loadPaperAccounts();
    if (activeViewId === "research") void loadResearchWorkspace();
  }

  function renderNavigation(container) {
    if (!container) return;
    navigationContainer = container;
    localizeWorkbench();
    container.replaceChildren();
    const financeScene = getTarget?.()?.sceneId === "finance";
    for (const group of ["Data", "Analysis", "Research", "Accounts"]) {
      const groupViews = views.filter((view) => view.group === group);
      if (!groupViews.length) continue;
      const details = document.createElement("details");
      details.className = "finance-nav-section";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = t(group);
      const body = document.createElement("div");
      body.className = "finance-nav-section-body";
      for (const view of groupViews) {
        const control = document.createElement("button");
        control.type = "button";
        control.className = "finance-nav-item";
        control.classList.toggle("active", activeViewId === view.id);
        control.setAttribute("aria-pressed", String(activeViewId === view.id));
        control.disabled = !financeScene;
        control.textContent = t(view.label);
        control.addEventListener("click", () => selectView(view.id));
        body.append(control);
      }
      details.append(summary, body);
      container.append(details);
    }
  }

  function renderContent(container) {
    if (!container) return;
    contentContainer = container;
    localizeWorkbench();
    container.replaceChildren();
    container.classList.add("finance-plugin-main");
    if (getTarget?.()?.sceneId !== "finance") {
      const guard = document.createElement("section");
      guard.className = "finance-scene-guard ui-card";
      const title = document.createElement("h1");
      title.textContent = t("Finance requires a Finance scene");
      const description = document.createElement("p");
      description.textContent = t(
        "Create or open a Finance scene to keep data, credentials, tools, and ledgers isolated.",
      );
      const configureButton = document.createElement("button");
      configureButton.type = "button";
      configureButton.className = "ui-button ui-button--primary";
      configureButton.textContent = t("Open scene settings");
      configureButton.addEventListener("click", () => openConfiguration?.());
      guard.append(title, description, configureButton);
      container.append(guard);
      return;
    }
    const view = views.find((candidate) => candidate.id === activeViewId) ?? views[0];
    if (view?.section) container.append(view.section);
  }

  function localizeWorkbench() {
    for (const [selector, key] of [
      ["#finance-qveris-status", "Checking…"],
      ["#finance-qveris-usage", "Usage & credits"],
      ["#finance-open-configuration", "Configure data key"],
      ["#finance-discovery-form button[type=submit]", "Discover"],
      ["#finance-snapshot-list", "Recent snapshots"],
      ["#finance-snapshot-sample", "Insert sample"],
      ["#finance-snapshot-form button[type=submit]", "Save snapshot"],
      ["#finance-backtest-sample", "Insert sample"],
      ["#finance-backtest-form button[type=submit]", "Run backtest"],
      ["#finance-screen-sample", "Insert sample"],
      ["#finance-screen-form button[type=submit]", "Rank candidates"],
      ["#finance-paper-refresh", "Refresh"],
      ["#finance-paper-account-form button[type=submit]", "Create account"],
      ["#finance-paper-order-form button[type=submit]", "Record simulated order"],
      ["#finance-paper-limit-form button[type=submit]", "Manage limit order"],
      ["#finance-paper-mark-form button[type=submit]", "Mark portfolio"],
      ["#finance-research-refresh", "Refresh"],
      ["#finance-research-form button[type=submit]", "Save research card"],
    ]) {
      const element = panel.querySelector(selector) ?? document.querySelector(selector);
      if (element) element.textContent = t(key);
    }
    for (const [view, headingKey, descriptionKey] of [
      [views[0], "QVeris financial data", "Live and historical capabilities"],
      [views[1], "Capability discovery", "Discover is free; inspect cost before calling."],
      [
        views[2],
        "Market data snapshots",
        "Preserve as-of time, currency and QVeris execution provenance.",
      ],
      [views[3], "Strategy backtest", "Deterministic next-bar execution with fees and slippage."],
      [views[4], "Multi-factor screener", "Explainable local ranking with missing-data coverage."],
      [views.find((view) => view.id === "research"), "Research workspace", "Watchlist, evidence, invalidation rules and upcoming events."],
      [views.find((view) => view.id === "paper"), "Paper trading", "Isolated simulation ledger; never sends real orders."],
    ]) {
      const heading = view?.section?.querySelector("h3");
      const description = view?.section?.querySelector(".finance-section-heading p");
      if (heading) heading.textContent = t(headingKey);
      if (description) description.textContent = t(descriptionKey);
    }
    if (paperAccountName) paperAccountName.placeholder = t("Account name");
  }

  const handleLocaleChange = () => {
    renderNavigation(navigationContainer);
    renderContent(contentContainer);
  };
  window.addEventListener("zicode:locale-changed", handleLocaleChange);
  setTarget();
  return {
    loadStatus,
    openPanel,
    setTarget,
    selectView,
    renderNavigation,
    renderContent,
    destroy() {
      window.removeEventListener("zicode:locale-changed", handleLocaleChange);
    },
  };
}

function renderDiscovery(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Capability discovery failed.")));
    return;
  }
  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  if (!results.length) {
    container.append(message(t("No matching capabilities found.")));
    return;
  }
  for (const result of results) {
    const card = document.createElement("div");
    card.className = "finance-result-card";
    const name = document.createElement("strong");
    name.textContent =
      result.name || result.capability || result.tool_id || t("Unknown capability");
    const provider = document.createElement("span");
    provider.textContent = [result.provider_name, result.expected_cost || result.cost_class]
      .filter(Boolean)
      .join(" · ");
    const identifier = document.createElement("code");
    identifier.textContent = result.tool_id || "";
    card.append(name, provider, identifier);
    container.append(card);
  }
}

function renderSnapshots(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Could not load snapshots.")));
    return;
  }
  const snapshots = Array.isArray(response.data?.snapshots) ? response.data.snapshots : [];
  if (!snapshots.length) {
    container.append(message(t("No market data snapshots yet.")));
    return;
  }
  for (const snapshot of snapshots) {
    const card = document.createElement("div");
    card.className = "finance-result-card";
    const title = document.createElement("strong");
    title.textContent = [snapshot.kind, snapshot.symbol].filter(Boolean).join(" · ");
    const provenance = document.createElement("span");
    provenance.textContent = [
      snapshot.asOf,
      snapshot.source?.provider,
      snapshot.source?.executionId,
    ]
      .filter(Boolean)
      .join(" · ");
    card.append(title, provenance);
    container.append(card);
  }
}

function renderBacktest(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Backtest failed.")));
    return;
  }
  const metrics = response.data?.metrics;
  if (!metrics) {
    container.append(message(t("Backtest returned no metrics.")));
    return;
  }
  const grid = document.createElement("div");
  grid.className = "finance-metrics";
  const entries = [
    ["Total return", percent(metrics.totalReturn)],
    ["CAGR", percent(metrics.cagr)],
    ["Maximum drawdown", percent(metrics.maxDrawdown)],
    ["Sharpe ratio", number(metrics.sharpeRatio)],
    ["Final equity", number(metrics.finalEquity)],
    ["Completed trades", number(metrics.completedTrades)],
  ];
  for (const [label, value] of entries) {
    const metric = document.createElement("div");
    metric.className = "finance-metric";
    const name = document.createElement("span");
    name.textContent = t(label);
    const output = document.createElement("strong");
    output.textContent = value;
    metric.append(name, output);
    grid.append(metric);
  }
  container.append(grid);
}

function renderUsage(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Could not load usage audit.")));
    return;
  }
  const usageData = response.data?.usage?.data || {};
  const ledgerData = response.data?.ledger?.data || {};
  const latestLedger = Array.isArray(ledgerData.items) ? ledgerData.items[0] : undefined;
  const summary = usageData.summary || {};
  const grid = document.createElement("div");
  grid.className = "finance-metrics";
  const entries = [
    [t("Recent requests"), number(summary.total_count ?? usageData.total)],
    [t("Settled credits"), number(summary.settled_credits)],
    [t("Available credits"), number(latestLedger?.balance_after?.total_available_credits)],
    [t("Audit samples"), number(Array.isArray(usageData.items) ? usageData.items.length : 0)],
  ];
  for (const [label, value] of entries) {
    const metric = document.createElement("div");
    metric.className = "finance-metric";
    const name = document.createElement("span");
    name.textContent = label;
    const output = document.createElement("strong");
    output.textContent = value;
    metric.append(name, output);
    grid.append(metric);
  }
  container.append(grid);
}

function renderScreening(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Screening failed.")));
    return;
  }
  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  if (!results.length) {
    container.append(message(t("No screening candidates returned.")));
    return;
  }
  for (const candidate of results) {
    const row = document.createElement("div");
    row.className = "finance-ranking-row";
    const rank = document.createElement("strong");
    rank.textContent = `#${candidate.rank}`;
    const identity = document.createElement("div");
    const symbol = document.createElement("strong");
    symbol.textContent = candidate.symbol || "—";
    const coverage = document.createElement("span");
    coverage.textContent = `${t("Coverage")} ${percent(candidate.coverage)}`;
    identity.append(symbol, coverage);
    const score = document.createElement("code");
    score.textContent = number(candidate.score);
    row.append(rank, identity, score);
    container.append(row);
  }
}

function renderResearchWorkspace(container, response, removeCard) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Could not load research workspace")));
    return;
  }
  const cards = Array.isArray(response.data?.cards) ? response.data.cards : [];
  if (!cards.length) {
    container.append(message(t("No research cards yet")));
    return;
  }
  const upcoming = cards
    .filter((card) => card.eventAt && new Date(card.eventAt).getTime() >= Date.now())
    .sort((left, right) => String(left.eventAt).localeCompare(String(right.eventAt)));
  if (upcoming.length) {
    const calendar = document.createElement("section");
    calendar.className = "finance-event-calendar";
    const heading = document.createElement("h4");
    heading.textContent = t("Upcoming events");
    calendar.append(heading);
    for (const card of upcoming.slice(0, 10)) {
      const event = document.createElement("div");
      event.className = "finance-event-row";
      const time = document.createElement("time");
      time.dateTime = card.eventAt;
      time.textContent = new Date(card.eventAt).toLocaleString();
      const label = document.createElement("strong");
      label.textContent = `${card.symbol} · ${card.title}`;
      event.append(time, label);
      calendar.append(event);
    }
    container.append(calendar);
  }
  const list = document.createElement("div");
  list.className = "finance-research-list";
  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "finance-research-card";
    const header = document.createElement("header");
    const identity = document.createElement("div");
    const symbol = document.createElement("span");
    symbol.className = "ui-badge";
    symbol.textContent = card.symbol;
    const title = document.createElement("h4");
    title.textContent = card.title || card.symbol;
    identity.append(symbol, title);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ui-button ui-button--ghost ui-button--sm";
    remove.textContent = t("Remove");
    remove.addEventListener("click", () => void removeCard?.(card.id));
    header.append(identity, remove);
    article.append(header);
    appendResearchSection(article, t("Thesis"), card.thesis);
    const cases = document.createElement("div");
    cases.className = "finance-research-cases";
    appendResearchSection(cases, t("Bull case"), card.bullCase, "positive");
    appendResearchSection(cases, t("Bear case"), card.bearCase, "negative");
    article.append(cases);
    appendResearchSection(article, t("Invalidation"), card.invalidation, "warning");
    if (card.sources?.length) appendResearchSection(article, t("Sources"), card.sources.join("\n"));
    list.append(article);
  }
  container.append(list);
}

function appendResearchSection(container, label, value, tone = "") {
  if (!value) return;
  const section = document.createElement("section");
  section.className = `finance-research-evidence${tone ? ` tone-${tone}` : ""}`;
  const heading = document.createElement("strong");
  heading.textContent = label;
  const content = document.createElement("p");
  content.textContent = value;
  section.append(heading, content);
  container.append(section);
}

function renderPaperAccounts(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Could not load paper accounts.")));
    return;
  }
  const accounts = Array.isArray(response.data?.accounts) ? response.data.accounts : [];
  if (!accounts.length) {
    container.append(message(t("No paper accounts yet.")));
    return;
  }
  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = "finance-paper-account";
    const name = document.createElement("strong");
    name.textContent = account.name || account.id;
    const details = document.createElement("span");
    details.textContent = `${account.baseCurrency || ""} · ${t("Cash")} ${number(account.cash)} · ${t("Positions")} ${number(account.positionCount)}`;
    const id = document.createElement("code");
    id.textContent = account.id;
    row.append(name, details, id);
    container.append(row);
  }
}

function renderPortfolioMark(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Could not mark portfolio.")));
    return;
  }
  const data = response.data || {};
  const grid = document.createElement("div");
  grid.className = "finance-metrics";
  for (const [label, value] of [
    ["Portfolio equity", data.equity],
    ["Market value", data.marketValue],
    ["Unrealized P&L", data.unrealizedPnl],
    ["Missing quotes", Array.isArray(data.missingSymbols) ? data.missingSymbols.length : 0],
    ["Gross exposure", data.risk?.grossExposure],
    ["Concentration HHI", data.risk?.concentrationHhi],
    ["Largest position weight", data.risk?.largestPosition?.weight],
    ["Stale positions", data.risk?.stalePositionCount],
  ]) {
    const metric = document.createElement("div");
    metric.className = "finance-metric";
    const name = document.createElement("span");
    name.textContent = t(label);
    const output = document.createElement("strong");
    output.textContent = ["Gross exposure", "Largest position weight"].includes(label)
      ? percent(value)
      : number(value);
    metric.append(name, output);
    grid.append(metric);
  }
  container.append(grid);
}

function renderLimitOrder(container, response) {
  container.replaceChildren();
  if (!response?.ok) {
    container.append(message(response?.error || t("Could not manage limit order.")));
    return;
  }
  const orders = Array.isArray(response.data?.processed)
    ? response.data.processed
    : response.data?.order
      ? [response.data.order]
      : [];
  if (!orders.length) {
    container.append(message(t("No pending orders were triggered.")));
    return;
  }
  for (const order of orders) {
    const card = document.createElement("div");
    card.className = "finance-result-card";
    const title = document.createElement("strong");
    title.textContent = `${order.side || ""} ${order.symbol || ""} × ${number(order.quantity)}`;
    const status = document.createElement("span");
    status.textContent = [order.status, order.limitPrice && `@ ${number(order.limitPrice)}`]
      .filter(Boolean)
      .join(" · ");
    const id = document.createElement("code");
    id.textContent = order.id || "";
    card.append(title, status, id);
    container.append(card);
  }
}

function setBusy(form, busy) {
  for (const control of form.querySelectorAll("button, input, textarea, select")) {
    control.disabled = busy;
  }
  form.setAttribute("aria-busy", String(busy));
}

function message(text) {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

function parseJsonInput(input, results, errorMessage) {
  try {
    return JSON.parse(input.value);
  } catch {
    results.replaceChildren(message(t(errorMessage)));
    return null;
  }
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function number(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat().format(value) : "—";
}

function shortTimestamp() {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function sampleBacktest() {
  const closes = [100, 101, 102, 101, 103, 105, 104, 106, 108, 107, 110, 112];
  return {
    bars: closes.map((close, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    })),
    strategy: { type: "sma_crossover", fastPeriod: 3, slowPeriod: 5 },
    initialCapital: 100000,
    feeBps: 5,
    slippageBps: 2,
  };
}

function sampleScreening() {
  return {
    securities: [
      { symbol: "AAA", name: "Quality Co", metrics: { roe: 0.24, pe: 16, momentum12m: 0.18 } },
      { symbol: "BBB", name: "Value Co", metrics: { roe: 0.15, pe: 8, momentum12m: 0.04 } },
      { symbol: "CCC", name: "Growth Co", metrics: { roe: 0.3, pe: 35, momentum12m: 0.28 } },
    ],
    factors: [
      { field: "roe", label: "ROE", direction: "high", weight: 0.4 },
      { field: "pe", label: "P/E", direction: "low", weight: 0.3 },
      { field: "momentum12m", label: "12M momentum", direction: "high", weight: 0.3 },
    ],
    top: 3,
  };
}

function sampleSnapshot() {
  return {
    kind: "quote",
    symbol: "600519.SH",
    market: "CN",
    currency: "CNY",
    asOf: new Date().toISOString(),
    source: {
      provider: "QVeris",
      toolId: "replace-with-discovered-tool-id",
      searchId: "replace-with-search-id",
      executionId: "replace-with-execution-id",
    },
    payload: { price: 1400 },
  };
}
