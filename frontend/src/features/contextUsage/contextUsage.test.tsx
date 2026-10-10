import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContextVizApp } from "./ContextUsageApp";
import {
  computeContextViz,
  findLatestAssistantUsage,
  formatTokens,
  usageTotal,
} from "./contextUsageLogic";
import { setupContextUsage } from "./index";

function renderFixture() {
  document.body.innerHTML = `
    <span class="pill token-usage" id="token-usage" title="Context usage"></span>
    <div class="context-viz hidden" id="context-viz">
      <div class="context-bar" id="context-bar"></div>
      <div class="context-legend" id="context-legend"></div>
      <div class="context-viz-footer">
        <span id="context-viz-used"></span>
        <span id="context-viz-total"></span>
      </div>
    </div>
  `;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("context usage (React)", () => {
  it("shows an empty state instead of a blank popover when no usage exists", () => {
    render(<ContextVizApp usage={null} contextWindowSize={128_000} />);
    expect(screen.getByText("暂无用量数据")).toBeTruthy();
  });

  it("localizes the empty-state pill tooltip", () => {
    renderFixture();
    setupContextUsage();
    expect(document.getElementById("token-usage")?.title).toBe("上下文用量");
  });

  it("keeps the context pill and popover synced from restored session history", () => {
    renderFixture();
    const ui = setupContextUsage();

    ui.setUsage({ input: 191, cacheRead: 9300 }, 128_000);

    const pill = document.getElementById("token-usage");
    expect(pill?.classList.contains("visible")).toBe(true);
    expect(pill?.textContent).toBe("7%");

    pill?.click();

    expect(document.getElementById("context-viz")?.classList.contains("hidden")).toBe(false);
    expect(document.getElementById("context-legend")?.textContent).toContain("已缓存（复用）");
    expect(document.getElementById("context-legend")?.textContent).toContain("9.3k");
    expect(document.getElementById("context-legend")?.textContent).toContain("未缓存");
    expect(document.getElementById("context-viz-used")?.textContent).toBe("7% 已用");
    expect(document.getElementById("context-viz-total")?.textContent).toBe("9.5k / 128.0k");
  });

  it("computes usage helpers", () => {
    expect(usageTotal({ input: 191, cacheRead: 9300 })).toBe(9491);
    expect(formatTokens(9491)).toBe("9.5k");
    expect(formatTokens(128000)).toBe("128.0k");
    expect(
      findLatestAssistantUsage([
        { role: "assistant", usage: { input: 1 } },
        { role: "user", content: "again" },
        { role: "assistant", usage: { input: 2, cacheRead: 3 } },
      ]),
    ).toEqual({ input: 2, cacheRead: 3 });
    const model = computeContextViz({ input: 191, cacheRead: 9300 }, 128_000);
    expect(model?.percent).toBe(7);
    expect(model?.segments.map((segment) => segment.key)).toEqual([
      "cache",
      "input",
      "free",
    ]);
  });
});
