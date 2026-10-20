import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createPluginResultActions } from "./plugin-result-actions.js";

const scope = {
  sceneId: "programming",
  workspaceId: "workspace",
  pluginId: "plugin",
  capabilityId: "echo",
};
const savedId = "22222222-2222-4222-8222-222222222222";
function setup(locale = "zh-CN", onOpenSaved) {
  setLocale(locale);
  document.body.replaceChildren();
  let target = "workspace";
  const gateway = {
    prepareSave: vi.fn(async () => ({
      grantId: "grant",
      preview: {
        title: "echo",
        text: "<script>unsafe</script>",
        byteLength: 23,
        packageVersion: "1",
        workspaceId: "workspace",
      },
    })),
    commitSave: vi.fn(async () => ({ schemaVersion: 1, artifact: { id: savedId }, replayed: false })),
    saveStatus: vi.fn(async () => ({ schemaVersion: 1, status: "unknown" })),
  };
  const actions = createPluginResultActions({
    container: document.body,
    gateway,
    isCurrent: (candidate) => candidate?.workspaceId === target,
    onOpenSaved,
  });
  actions.show({ resultRef: { resultId: "result" } }, scope);
  return {
    actions,
    gateway,
    switchTarget: () => {
      target = "another";
    },
  };
}
const click = (text) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent === text).click();
afterEach(() => document.body.replaceChildren());

it("localizes the trusted save panel in English", () => {
  setup("en");
  expect(document.querySelector('[aria-label="Studio result saving"]')).toBeTruthy();
  expect(document.body.textContent).toContain("Preview save");
});

it("offers a Host captured model result through the same save and transfer panel", () => {
  const { actions, gateway } = setup("en");
  gateway.prepareSave.mockResolvedValue({
    grantId: "model-grant",
    preview: { title: "Generated result", text: "Generated text", byteLength: 14,
      packageVersion: "0.1.0", workspaceId: "workspace" },
  });
  const modelScope = { ...scope, capabilityId: "model.generate.v1" };
  actions.show({
    operation: "model.generate",
    result: { modelRef: "model-ref", text: "Generated text" },
    resultRef: { resultId: "host-result" },
  }, modelScope);
  expect(document.body.textContent).toContain("Preview save");
  click("Preview save");
  return vi.waitFor(() => expect(document.querySelector("pre")?.textContent).toBe("Generated text"));
});

it("shows model text when Host refuses result capture", () => {
  const { actions } = setup("en");
  actions.show({
    operation: "model.generate",
    result: { modelRef: "model-ref", text: "Generated text" },
    resultCaptureError: { code: "result_capture_unavailable" },
  }, { ...scope, capabilityId: "model.generate.v1" });
  expect(document.body.textContent).toContain("Generated text");
  expect(document.body.textContent).toContain("result_capture_unavailable");
});

it("previews an explicitly captured JSON object without treating it as plain text", async () => {
  const { actions, gateway } = setup("en");
  gateway.prepareSave.mockResolvedValueOnce({ grantId: "json-grant", preview: {
    title: "Structured result", text: '{"count":2}', mimeType: "application/json",
    byteLength: 11, packageVersion: "1", workspaceId: "workspace" } });
  actions.show({ result: { ok: true, data: { count: 2 } },
    resultRef: { schemaVersion: 2, resultId: "json-result", mimeType: "application/json" } }, scope);
  click("Preview save");
  await vi.waitFor(() => expect(document.querySelector("pre")?.textContent).toBe('{"count":2}'));
  expect(document.body.textContent).toContain("saved as application/json");
  expect(gateway.commitSave).not.toHaveBeenCalled();
});

it("previews safely and writes only after explicit parent confirmation", async () => {
  const { gateway } = setup();
  click("预览保存");
  await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  expect(document.querySelector("pre").textContent).toBe("<script>unsafe</script>");
  expect(document.querySelector("script")).toBeNull();
  expect(gateway.commitSave).not.toHaveBeenCalled();
  click("取消保存");
  expect(gateway.commitSave).not.toHaveBeenCalled();
  click("预览保存");
  await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("确认保存");
  await vi.waitFor(() => expect(gateway.commitSave).toHaveBeenCalledWith(scope, "grant"));
});

it("ignores late preparation after a new result or workspace switch", async () => {
  const { actions, gateway, switchTarget } = setup();
  let resolve;
  gateway.prepareSave.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  click("预览保存");
  actions.clear();
  resolve({ preview: { text: "stale" } });
  await Promise.resolve();
  expect(document.querySelector("pre")).toBeNull();
  actions.show({ resultRef: { resultId: "new" } }, scope);
  click("预览保存");
  switchTarget();
  resolve({ preview: { text: "stale" } });
  await Promise.resolve();
  expect(document.querySelector("pre")).toBeNull();
  expect(gateway.commitSave).not.toHaveBeenCalled();
});

it("retains the user's title after cancelling preview and resets it for a new result", async () => {
  const { actions, gateway } = setup();
  const title = document.querySelector('input[aria-label="保存标题"]');
  title.value = "custom title";
  title.dispatchEvent(new Event("input", { bubbles: true }));
  click("预览保存");
  await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("取消保存");
  expect(document.querySelector('input[aria-label="保存标题"]').value).toBe("custom title");
  click("预览保存");
  await vi.waitFor(() =>
    expect(gateway.prepareSave).toHaveBeenLastCalledWith(scope, "result", "custom title"),
  );
  actions.show({ resultRef: { resultId: "another-result" } }, scope);
  expect(document.querySelector('input[aria-label="保存标题"]').value).toBe("echo 结果");
});

it("keeps a lost save response uncertain, hides private errors and does not retry", async () => {
  const { actions, gateway, switchTarget } = setup();
  gateway.commitSave.mockRejectedValueOnce(new Error("C:\\private\\workspace\\secret.txt"));
  click("预览保存");
  await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("确认保存");
  await vi.waitFor(() => expect(gateway.saveStatus).toHaveBeenCalledWith(scope, "grant"));
  expect(document.body.textContent).not.toContain("secret.txt");
  expect([...document.querySelectorAll("button")].some(node => node.textContent === "确认保存")).toBe(false);
  click("关闭");
  expect([...document.querySelectorAll("button")].find(node => node.textContent === "预览保存").disabled).toBe(true);
  actions.show({ resultRef: { resultId: "other-result" } }, scope);
  expect([...document.querySelectorAll("button")].find(node => node.textContent === "预览保存").disabled).toBe(false);
  switchTarget();
  expect(gateway.commitSave).toHaveBeenCalledTimes(1);
});

it("does not display private Host text when save preparation fails", async () => {
  const { gateway } = setup();
  gateway.prepareSave.mockRejectedValueOnce(new Error("C:\\private\\workspace\\secret.txt"));
  click("预览保存");
  await vi.waitFor(() => expect(document.body.textContent).toContain("无法准备保存"));
  expect(document.body.textContent).not.toContain("secret.txt");
  expect(gateway.commitSave).not.toHaveBeenCalled();
});

it("automatically recovers a saved result by read-only status and opens it only on explicit click", async () => {
  const open = vi.fn(), { gateway } = setup("en", open);
  gateway.commitSave.mockRejectedValueOnce(new Error("response lost"));
  gateway.saveStatus.mockResolvedValueOnce({ schemaVersion: 1, status: "saved", artifactId: savedId });
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("Verified saved artifact"));
  expect(gateway.saveStatus).toHaveBeenCalledWith(scope, "grant");
  expect(gateway.commitSave).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  click("View saved artifact"); expect(open).toHaveBeenCalledWith(savedId, scope);
});

it("keeps an unknown read-only result uncertain, permits rechecking and never retries the write", async () => {
  const { gateway } = setup("en");
  gateway.commitSave.mockRejectedValueOnce(new Error("response lost"));
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("could not be verified"));
  expect(gateway.saveStatus).toHaveBeenCalledTimes(1);
  click("Check save status"); await vi.waitFor(() => expect(gateway.saveStatus).toHaveBeenCalledTimes(2));
  expect(gateway.commitSave).toHaveBeenCalledOnce();
  expect(document.body.textContent).not.toContain("View saved artifact");
});

it("rejects a malformed status receipt without opening an artifact", async () => {
  const open = vi.fn(), { gateway } = setup("en", open);
  gateway.commitSave.mockRejectedValueOnce(new Error("response lost"));
  gateway.saveStatus.mockResolvedValueOnce({ schemaVersion: 1, status: "saved", artifactId: "../../private" });
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("could not be verified"));
  expect(open).not.toHaveBeenCalled();
  expect(gateway.commitSave).toHaveBeenCalledOnce();
});

it("ignores automatic save-status recovery after the workspace changes", async () => {
  const open = vi.fn(), { gateway, switchTarget } = setup("en", open);
  let resolveStatus;
  gateway.commitSave.mockRejectedValueOnce(new Error("response lost"));
  gateway.saveStatus.mockImplementation(() => new Promise(resolve => { resolveStatus = resolve; }));
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(gateway.saveStatus).toHaveBeenCalledOnce());
  switchTarget();
  resolveStatus({ schemaVersion: 1, status: "saved", artifactId: savedId });
  await Promise.resolve(); await Promise.resolve();
  expect(document.body.textContent).not.toContain("Verified saved artifact");
  expect(open).not.toHaveBeenCalled();
  expect(gateway.commitSave).toHaveBeenCalledOnce();
});

it("offers exact saved-artifact navigation only after confirmed save and explicit click", async () => {
  const open = vi.fn(), { gateway } = setup("zh-CN", open);
  gateway.commitSave.mockResolvedValue({ schemaVersion: 1, artifact: { id: savedId }, replayed: true });
  expect(document.body.textContent).not.toContain("查看已保存产物");
  click("预览保存"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  expect(gateway.commitSave).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  click("确认保存"); await vi.waitFor(() => expect(document.body.textContent).toContain("查看已保存产物"));
  expect(open).not.toHaveBeenCalled();
  click("查看已保存产物");
  expect(open).toHaveBeenCalledWith(savedId, scope);
  expect(gateway.commitSave).toHaveBeenCalledTimes(1);
});

it("does not navigate from a stale saved-result button", async () => {
  const open = vi.fn(), { actions, gateway, switchTarget } = setup("en", open);
  gateway.commitSave.mockResolvedValue({ schemaVersion: 1, artifact: { id: savedId }, replayed: false });
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("View saved artifact"));
  const stale = [...document.querySelectorAll("button")].find(node => node.textContent === "View saved artifact");
  switchTarget(); stale.click(); expect(open).not.toHaveBeenCalled();
  actions.clear(); stale.click(); expect(open).not.toHaveBeenCalled();
});

it("ignores a late successful save after its result controller is cleared", async () => {
  const open = vi.fn(), { actions, gateway } = setup("en", open); let finish;
  gateway.commitSave.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); actions.clear(); finish({ artifact: { id: "saved-id" } });
  await Promise.resolve(); await Promise.resolve();
  expect(document.body.textContent).not.toContain("View saved artifact"); expect(open).not.toHaveBeenCalled();
});

it("does not offer navigation after a failed save", async () => {
  const open = vi.fn(), { gateway } = setup("en", open);
  gateway.commitSave.mockRejectedValueOnce(new Error("storage unavailable"));
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("could not be verified"));
  expect(document.body.textContent).not.toContain("View saved artifact");
  expect(document.body.textContent).not.toContain("storage unavailable");
  expect(gateway.commitSave).toHaveBeenCalledOnce();
});

it("treats an invalid save receipt as uncertain rather than claiming success", async () => {
  const open = vi.fn(), { gateway } = setup("en", open);
  gateway.commitSave.mockResolvedValue({ schemaVersion: 1, artifact: { id: {} }, replayed: false });
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("could not be verified"));
  expect(document.body.textContent).not.toContain("View saved artifact"); expect(open).not.toHaveBeenCalled();
});
