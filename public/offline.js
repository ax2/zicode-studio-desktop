const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 4_000;

const STATUS_COPY = {
  offline: ["正在等待网络恢复…", "Waiting for the network…"],
  checking: ["网络可用，正在检查 ZiCode 桌面端…", "Network available. Checking the ZiCode desktop…"],
  unavailable: [
    "网络已连接，但暂时无法访问 ZiCode 桌面端。",
    "The network is online, but the ZiCode desktop is still unreachable.",
  ],
  ready: ["已找到 ZiCode，正在恢复当前页面…", "ZiCode is available. Restoring the current page…"],
};

export function setupOfflineRecovery({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  fetchRef = globalThis.fetch,
  reload = () => windowRef.location.reload(),
  retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
} = {}) {
  const status = documentRef?.getElementById("offline-status");
  const statusZh = documentRef?.getElementById("offline-status-zh");
  const statusEn = documentRef?.getElementById("offline-status-en");
  const retryButton = documentRef?.getElementById("offline-retry");
  if (!status || !statusZh || !statusEn || !retryButton) return null;

  const locale = /^zh(?:-|$)/i.test(navigatorRef.language || documentRef.documentElement.lang)
    ? "zh"
    : "en";
  documentRef.documentElement.dataset.locale = locale;
  documentRef.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  documentRef.title = locale === "zh" ? "ZiCode · 离线" : "ZiCode · Offline";
  documentRef
    .querySelector(".checklist")
    ?.setAttribute("aria-label", locale === "zh" ? "连接检查清单" : "Connection checklist");

  let checking = false;
  let disposed = false;
  let retryTimer = null;
  let activeController = null;

  function render(state) {
    const copy = STATUS_COPY[state] || STATUS_COPY.unavailable;
    status.dataset.state = state;
    statusZh.textContent = copy[0];
    statusEn.textContent = copy[1];
    retryButton.disabled = state === "checking" || state === "ready";
    retryButton.textContent =
      state === "checking"
        ? locale === "zh"
          ? "正在检查…"
          : "Checking…"
        : locale === "zh"
          ? "立即重试"
          : "Try now";
  }

  function clearRetryTimer() {
    if (retryTimer === null) return;
    windowRef.clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry() {
    if (
      disposed ||
      retryTimer !== null ||
      !navigatorRef.onLine ||
      documentRef.visibilityState === "hidden"
    ) {
      return;
    }
    retryTimer = windowRef.setTimeout(() => {
      retryTimer = null;
      void checkDesktop();
    }, retryIntervalMs);
  }

  async function checkDesktop() {
    if (disposed || checking) return false;
    clearRetryTimer();
    if (!navigatorRef.onLine) {
      render("offline");
      return false;
    }

    checking = true;
    render("checking");
    const controller = new AbortController();
    activeController = controller;
    const timeout = windowRef.setTimeout(() => controller.abort(), healthTimeoutMs);
    let available = false;
    try {
      const response = await fetchRef("/health", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      available = response.ok;
    } catch {
      available = false;
    } finally {
      windowRef.clearTimeout(timeout);
      if (activeController === controller) activeController = null;
      checking = false;
    }

    if (disposed) return false;
    if (available) {
      render("ready");
      reload();
      return true;
    }
    render(navigatorRef.onLine ? "unavailable" : "offline");
    scheduleRetry();
    return false;
  }

  const onOnline = () => void checkDesktop();
  const onOffline = () => {
    activeController?.abort();
    clearRetryTimer();
    render("offline");
  };
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "hidden") {
      clearRetryTimer();
      return;
    }
    void checkDesktop();
  };
  const onRetry = () => void checkDesktop();

  windowRef.addEventListener("online", onOnline);
  windowRef.addEventListener("offline", onOffline);
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  retryButton.addEventListener("click", onRetry);
  if (navigatorRef.onLine) void checkDesktop();
  else render("offline");

  return {
    checkNow: checkDesktop,
    dispose() {
      disposed = true;
      clearRetryTimer();
      activeController?.abort();
      windowRef.removeEventListener("online", onOnline);
      windowRef.removeEventListener("offline", onOffline);
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      retryButton.removeEventListener("click", onRetry);
    },
  };
}
