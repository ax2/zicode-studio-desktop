import { cleanup, render } from "@testing-library/react";
import { translateDocument } from "i18n";
import { afterEach, expect, it } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ConfigTab } from "./ConfigTab";
import { createConfigStore } from "./configStore";
import { createSettingsWidgetsStore } from "./settingsWidgetsStore";

afterEach(() => { cleanup();setLocale("zh-CN"); });

it("preserves configured names and paths while translating surrounding model controls", async () => {
  setLocale("zh-CN");
  const store = createConfigStore({ configGateway: { call: async () => ({ ok: true }) } });
  store.setState({
    apiStatus: "ready", providers: [{ provider: "fixture", displayName: "Settings", configured: true, models: [{ id: "fixture-model", name: "Update", available: true }] }],
    channelStatus: "ready", channels: [{ provider: "fixture", displayName: "Settings", revision: "fixture-revision" }],
    configEditor: { path: "Settings", content: "{}", loading: false, saving: false, message: null },
    modelsEditor: { path: "Update", content: "{}", loading: false, saving: false, message: null },
  });
  const view = render(<ConfigTab store={store} widgets={createSettingsWidgetsStore()} />);
  const assertNames = () => {
    expect(view.container.querySelector(".api-key-row-info .api-key-row-name")?.textContent).toBe("Settings");
    expect(view.container.querySelector(".provider-channel-row strong")?.textContent).toBe("Settings");
    expect(view.container.querySelector(".api-model-name")?.textContent).toBe("Update");
    expect(view.container.querySelector("#inline-config-path")?.textContent).toBe("Settings");
    expect(view.container.querySelector("#inline-models-path")?.textContent).toBe("Update");
  };
  translateDocument(view.container);assertNames();
    expect(view.container.querySelector(".api-key-row-actions button")?.textContent).toBe("检查健康状态");
  setLocale("en");translateDocument(view.container);assertNames();
  setLocale("zh-CN");translateDocument(view.container);assertNames();
});
