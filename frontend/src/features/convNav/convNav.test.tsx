import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ConvNavTrack, ConvNavTooltip } from "./ConvNavApp";
import { gaussianWidth, tooltipUserPreview } from "./convNavLogic";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("conversation navigator (React)", () => {
  it("renders one dot per turn with active state and click handling", () => {
    const onDotClick = vi.fn();
    const { container } = render(
      <ConvNavTrack
        turnCount={3}
        activeIdx={1}
        hoveredIdx={-1}
        onDotClick={onDotClick}
        onDotEnter={() => {}}
        onDotLeave={() => {}}
      />,
    );
    const dots = container.querySelectorAll(".conv-nav-dot");
    expect(dots).toHaveLength(3);
    expect(dots[1].classList.contains("active")).toBe(true);
    (dots[2] as HTMLElement).click();
    expect(onDotClick).toHaveBeenCalledWith(2);
  });

  it("renders the tooltip content and hides the answer separator when absent", () => {
    const { container } = render(<ConvNavTooltip q="Question" a="" />);
    expect(container.querySelector("#conv-nav-tooltip-q")?.textContent).toBe(
      "Question",
    );
    expect(
      container.querySelector("#conv-nav-tooltip-sep")?.getAttribute("style"),
    ).toContain("none");
  });

  it("computes gaussian wave widths and user previews", () => {
    expect(gaussianWidth(0)).toBe(20);
    expect(gaussianWidth(3)).toBe(16);
    const user = document.createElement("div");
    user.textContent = "  a very long prompt ".repeat(10);
    expect(tooltipUserPreview(user).length).toBe(120);
  });
});
