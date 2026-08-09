import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { t } from "../../shared/i18n";
import { ContextVizApp, TokenUsagePill } from "./ContextUsageApp";
import {
  formatTokens,
  normalizeUsage,
  usageTotal,
  type UsageLike,
} from "./contextUsageLogic";

export interface ContextUsageControl {
  clear(): void;
  setContextWindowSize(nextContextWindowSize: number | string | null | undefined): void;
  setUsage(
    nextUsage: UsageLike | null,
    nextContextWindowSize?: number | string,
  ): void;
  readonly usage: UsageLike | null;
  readonly contextWindowSize: number;
}

export { findLatestAssistantUsage, usageTotal } from "./contextUsageLogic";

export function setupContextUsage({
  tokenUsageEl = document.getElementById("token-usage"),
  contextViz = document.getElementById("context-viz"),
}: {
  tokenUsageEl?: HTMLElement | null;
  contextViz?: HTMLElement | null;
} = {}): ContextUsageControl {
  let usage: UsageLike | null = null;
  let contextWindowSize = 0;

  const pillRoot: Root | null = tokenUsageEl ? createRoot(tokenUsageEl) : null;
  const vizRoot: Root | null = contextViz ? createRoot(contextViz) : null;

  function renderPill() {
    if (!pillRoot || !tokenUsageEl) return;
    const used = usageTotal(usage);
    tokenUsageEl.classList.remove("warning", "critical");

    if (used <= 0) {
      tokenUsageEl.classList.remove("visible");
      flushSync(() => {
        pillRoot.render(createElement(TokenUsagePill, { text: "" }));
      });
      tokenUsageEl.title = "Context usage";
      hide();
      return;
    }

    tokenUsageEl.classList.add("visible");
    let text = "";
    let title = "";
    if (contextWindowSize > 0) {
      const percent = Math.round((used / contextWindowSize) * 100);
      text = `${percent}%`;
      title = t("Context: {used} / {total} tokens")
        .replace("{used}", formatTokens(used))
        .replace("{total}", formatTokens(contextWindowSize));
      if (percent >= 80) {
        tokenUsageEl.classList.add("critical");
      } else if (percent >= 60) {
        tokenUsageEl.classList.add("warning");
      }
    } else {
      text = formatTokens(used);
      title = t("Context: {used} tokens").replace("{used}", formatTokens(used));
    }
    flushSync(() => {
      pillRoot.render(createElement(TokenUsagePill, { text }));
    });
    tokenUsageEl.title = title;
  }

  function renderViz() {
    if (!vizRoot) return;
    flushSync(() => {
      vizRoot.render(
        createElement(ContextVizApp, {
          usage,
          contextWindowSize,
        }),
      );
    });
  }

  function hide() {
    contextViz?.classList.add("hidden");
  }

  function show() {
    if (!contextViz) return;
    renderViz();
    contextViz.classList.remove("hidden");
  }

  function setUsage(
    nextUsage: UsageLike | null,
    nextContextWindowSize: number | string = contextWindowSize,
  ) {
    usage = normalizeUsage(nextUsage);
    contextWindowSize =
      Number(nextContextWindowSize) || Number(usage?.contextWindow) || 0;
    renderPill();
    if (contextViz && !contextViz.classList.contains("hidden")) renderViz();
  }

  function setContextWindowSize(
    nextContextWindowSize: number | string | null | undefined,
  ) {
    contextWindowSize = Number(nextContextWindowSize) || 0;
    renderPill();
    if (contextViz && !contextViz.classList.contains("hidden")) renderViz();
  }

  function clear() {
    usage = null;
    contextWindowSize = 0;
    renderPill();
  }

  if (tokenUsageEl) {
    tokenUsageEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (contextViz?.classList.contains("hidden")) {
        show();
      } else {
        hide();
      }
    });
  }
  document.addEventListener("click", (event) => {
    if (
      contextViz &&
      !contextViz.classList.contains("hidden") &&
      !contextViz.contains(event.target as Node) &&
      event.target !== tokenUsageEl
    ) {
      hide();
    }
  });

  renderPill();

  return {
    clear,
    setContextWindowSize,
    setUsage,
    get usage() {
      return usage;
    },
    get contextWindowSize() {
      return contextWindowSize;
    },
  };
}
