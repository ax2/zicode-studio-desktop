import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { confirmPluginModelGeneration } from "./plugin-model-consent.js";
import { showNativeDialog } from "../react/dialog.js";

afterEach(() => { document.body.innerHTML = ""; setLocale("zh-CN"); });

it("shows the complete Host-built outbound prompt and destination before approval", async () => {
  setLocale("en");
  document.body.innerHTML = '<div id="dialog-container" class="hidden"></div>';
  const preview = { promptPreview: JSON.stringify({ goal: "Explain", materials: [{ text: "sample data" }] }),
    destination: "https://model.example", displayName: "Example", inputBytes: 18,
    expiresInMs: 120_000 };
  const showDialog = vi.fn(async ({ title, options, timeout }) => {
    expect(title).toContain("https://model.example");
    expect(title).toContain("sample data");
    expect(options).toEqual(["Send to model"]);
    expect(timeout).toBe(120_000);
    return { value: "Send to model" };
  });
  expect(await confirmPluginModelGeneration(preview, "Example plugin", showDialog)).toBe(true);
  expect(showDialog).toHaveBeenCalledTimes(1);
  document.getElementById("dialog-container").classList.remove("hidden");
  expect(await confirmPluginModelGeneration(preview, "Example plugin", showDialog)).toBe(false);
  expect(showDialog).toHaveBeenCalledTimes(1);
});

it("closes the trusted model consent dialog when its View request is cancelled", async () => {
  document.body.innerHTML = '<div id="dialog-container" class="hidden"></div>';
  const preview = { promptPreview: "{}", destination: "https://model.example",
    displayName: "Example", inputBytes: 2, expiresInMs: 30_000 };
  let dismiss;
  const dismissSignal = new Promise((resolve) => { dismiss = resolve; });
  const container = document.getElementById("dialog-container");
  const result = confirmPluginModelGeneration(preview, "Example", showNativeDialog,
    container, dismissSignal);
  expect(container.classList.contains("hidden")).toBe(false);
  dismiss();
  await expect(result).resolves.toBe(false);
  expect(container.classList.contains("hidden")).toBe(true);
});
