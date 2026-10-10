import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileSendLaterBanner } from "./MobileSendLaterApp";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("mobile send later banner (React)", () => {
  it("renders the offline banner with disabled send and actionable keep-draft", () => {
    const onSendNow = vi.fn();
    const onKeepDraft = vi.fn();
    const { container } = render(
      <MobileSendLaterBanner
        active
        connected={false}
        busy={false}
        onSendNow={onSendNow}
        onKeepDraft={onKeepDraft}
      />,
    );
    const banner = container.querySelector(".mobile-send-later") as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).not.toBe("");
    const buttons = banner.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    (buttons[1] as HTMLButtonElement).click();
    expect(onKeepDraft).toHaveBeenCalledTimes(1);
    expect(onSendNow).not.toHaveBeenCalled();
  });

  it("hides the banner while inactive", () => {
    const { container } = render(
      <MobileSendLaterBanner
        active={false}
        connected
        busy={false}
        onSendNow={() => {}}
        onKeepDraft={() => {}}
      />,
    );
    expect(
      (container.querySelector(".mobile-send-later") as HTMLElement).hidden,
    ).toBe(true);
  });
});
