import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { confirmPluginModelGeneration } from "./plugin-model-consent.js";

afterEach(() => { document.body.innerHTML = ""; setLocale("zh-CN"); });

it("shows the complete Host-built outbound prompt and destination before approval", async () => {
  setLocale("en");
  document.body.innerHTML = '<div id="dialog-container" class="hidden"></div>';
  const preview = { promptPreview: JSON.stringify({ goal: "Explain", materials: [{ text: "sample data" }] }),
    destination: "https://model.example", displayName: "Example", inputBytes: 18 };
  const showDialog = vi.fn(async ({ title, options }) => {
    expect(title).toContain("https://model.example");
    expect(title).toContain("sample data");
    expect(options).toEqual(["Send to model"]);
    return { value: "Send to model" };
  });
  expect(await confirmPluginModelGeneration(preview, "Example plugin", showDialog)).toBe(true);
  expect(showDialog).toHaveBeenCalledTimes(1);
  document.getElementById("dialog-container").classList.remove("hidden");
  expect(await confirmPluginModelGeneration(preview, "Example plugin", showDialog)).toBe(false);
  expect(showDialog).toHaveBeenCalledTimes(1);
});
