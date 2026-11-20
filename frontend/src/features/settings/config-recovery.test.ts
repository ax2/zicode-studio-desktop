import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";
import { describeModelError, friendlyToolError } from "../chat/chatLogic";
import { createConfigStore } from "./configStore";

afterEach(() => setLocale("zh-CN"));

describe("model settings recovery without legacy scene terminology", () => {
  it.each(["zh-CN", "en"])("points failures at available settings in %s", locale => {
    setLocale(locale);
    const messages = [
      describeModelError({ error: "401 unauthorized" }).suggestion,
      describeModelError({ error: "unrecognized failure" }).suggestion,
      friendlyToolError("tool_unavailable"),
      friendlyPluginError("model_config_unavailable"),
      friendlyPluginError("Translation model key is not configured for this scene"),
      friendlyPluginError("QVeris API key is not configured for this scene"),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/scene|场景/i);
      expect(message).toMatch(locale === "en" ? /settings|permission|enabled/i : /设置|权限|启用/);
    }
  });

  it("explains how to recover a missing conversation without writing credentials", async () => {
    setLocale("zh-CN");
    const call = vi.fn(), invoke = vi.fn(), confirmImpl = vi.fn();
    const store = createConfigStore({ configGateway: { call }, invoke, confirmImpl, getTarget: () => null });
    await store.getState().openApiKeyEditor({ provider: "fixture" });
    store.getState().setApiKeyInput("fixture-key");
    await store.getState().saveApiKey();
    expect(store.getState().apiKeyError).toBe("请先打开一个对话，再修改模型设置。");
    await store.getState().removeChannel({ provider: "fixture", revision: "fixture-revision" });
    expect(store.getState().channelError).toBe("请先打开一个对话，再修改模型设置。");
    expect(store.getState().apiKeyInput).toBe("fixture-key");
    expect(call).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(confirmImpl).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "en"])("localizes key and channel removal confirmations in %s and preserves names literally", async locale => {
    setLocale(locale);
    const call = vi.fn(), invoke = vi.fn(), confirmImpl = vi.fn((_message: string) => false);
    const store = createConfigStore({ configGateway: { call }, invoke, confirmImpl });
    const name = 'Settings $& {provider} 中文';
    await store.getState().removeApiKey({ provider: "fixture", displayName: name });
    await store.getState().removeChannel({ provider: name, revision: "fixture-revision" });
    expect(confirmImpl.mock.calls.map(args => args[0])).toEqual(locale === "en" ? [
      `Remove the stored API key for "${name}"?`,
      `Remove model channel "${name}" and its stored key?`,
    ] : [
      `删除“${name}”已保存的 API 密钥？`,
      `删除模型渠道“${name}”及其已保存的密钥？`,
    ]);
    expect(call).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the confirmation target isolated when settings change while awaiting the answer", async () => {
    setLocale("zh-CN");
    const call = vi.fn(), invoke = vi.fn();
    let answer: (value: boolean) => void = () => {};
    let target = { sceneId: "programming" };
    const confirmImpl = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; }));
    const store = createConfigStore({ configGateway: { call }, invoke, confirmImpl, getTarget: () => target });
    const pending = store.getState().removeChannel({ provider: "fixture", revision: "fixture-revision" });
    expect(confirmImpl).toHaveBeenCalledOnce();
    target = { sceneId: "finance" };store.getState().setTarget(target);
    answer(true);await pending;
    expect(call).not.toHaveBeenCalled();expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects an editor from an earlier configuration without exposing its internal identifier", async () => {
    setLocale("zh-CN");
    const call = vi.fn();let target = { sceneId: "programming" };
    const store = createConfigStore({ configGateway: { call }, getTarget: () => target });
    await store.getState().openChannelEditor(null);
    store.getState().setChannelForm({ provider: "fixture", apiKey: "fixture-key" });
    target = { sceneId: "private-fixture-id" };
    await store.getState().saveChannel();
    expect(store.getState().channelEditorError).toBe("当前配置已切换，请重新打开此模型渠道再保存。");
    expect(store.getState().channelEditor?.apiKey).toBe("fixture-key");
    expect(call).not.toHaveBeenCalled();
  });
});
