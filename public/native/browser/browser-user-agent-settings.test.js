import { expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
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
function toggleSection(panel, open) {
  return new Promise(resolve => {
    panel.addEventListener("toggle", resolve, { once: true });
    panel.open = open;
  });
}

it("keeps a save in flight when the settings section is closed and reopened", async () => {
  let finishSave;
  const saveReceipt = new Promise(resolve => { finishSave = resolve; });
  const control = vi.fn(request =>
    request.kind === "getUserAgent" ? Promise.resolve("Existing/1") : saveReceipt);
  const panel = createBrowserUserAgentSettings(control);
  document.body.append(panel);
  try {
    const input = panel.querySelector("input");
    const save = panel.querySelector("button");
    const status = panel.querySelector("[role=status]");
    await toggleSection(panel, true);
    await waitFor(() => expect(input.value).toBe("Existing/1"));

    input.value = "Updated/2";
    save.click();
    expect(save.disabled).toBe(true);
    await toggleSection(panel, false);
    await toggleSection(panel, true);
    expect(control.mock.calls).toEqual([
      [{ kind: "getUserAgent" }],
      [{ kind: "setUserAgent", value: "Updated/2" }],
    ]);
    expect(input.value).toBe("Updated/2");
    expect(save.disabled).toBe(true);

    finishSave("Updated/2");
    await waitFor(() => expect(status.textContent).toBe(t("User-Agent saved for new tabs")));
    expect(input.value).toBe("Updated/2");
    expect(save.disabled).toBe(false);
  } finally {
    finishSave("Updated/2");
    panel.remove();
  }
});

it("keeps writes disabled after a failed settings read until a reopen succeeds", async () => {
  const control = vi.fn()
    .mockRejectedValueOnce(Error("Unavailable"))
    .mockResolvedValueOnce("Recovered/1");
  const panel = createBrowserUserAgentSettings(control);
  document.body.append(panel);
  try {
    const input = panel.querySelector("input");
    const [save, reset] = panel.querySelectorAll("button");
    const status = panel.querySelector("[role=status]");
    await toggleSection(panel, true);
    await waitFor(() => expect(status.textContent).toBe(t("Unavailable")));
    expect(input.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    expect(reset.disabled).toBe(true);
    save.click();
    reset.click();
    expect(control.mock.calls).toEqual([[{ kind: "getUserAgent" }]]);

    await toggleSection(panel, false);
    await toggleSection(panel, true);
    await waitFor(() => expect(input.value).toBe("Recovered/1"));
    expect(save.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
  } finally {
    panel.remove();
  }
});
