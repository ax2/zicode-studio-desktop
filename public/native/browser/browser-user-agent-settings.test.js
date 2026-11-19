import { expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { createBrowserUserAgentSettings } from "./browser-user-agent-settings.js";

it("keeps Enter in the settings, reflects failures and restores the default", async () => {
  const control = vi.fn(async request => {
    if (request.value === "bad") throw Error("Rejected");
    return request.kind === "getUserAgent" ? "Existing/1" : request.value;
  });
  const nav = document.createElement("form");
  const navigate = vi.fn(event => event.preventDefault());
  nav.addEventListener("submit", navigate);
  const panel = createBrowserUserAgentSettings(control);
  nav.append(panel); document.body.append(nav);
  try {
    panel.open = true;
    const input = panel.querySelector("input");
    await waitFor(() => expect(input.value).toBe("Existing/1"));
    input.value = "bad";
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true, bubbles: true });
    input.dispatchEvent(enter);
    await waitFor(() => expect(panel.querySelector("[role=status]").textContent).toBe("Rejected"));
    expect(enter.defaultPrevented).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(input.value).toBe("bad");
    panel.querySelectorAll("button")[1].click();
    await waitFor(() => expect(input.value).toBe(""));
    expect(control).toHaveBeenLastCalledWith({ kind: "setUserAgent", value: null });
  } finally { nav.remove(); }
});