import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createPluginResultActions } from "./plugin-result-actions.js";

const scope = {
  sceneId: "programming",
  workspaceId: "workspace",
  pluginId: "plugin",
  capabilityId: "echo",
};
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
    commitSave: vi.fn(async () => ({ artifact: {} })),
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

it("retries the same grant on storage failure and prevents writes after target change", async () => {
  const { gateway, switchTarget } = setup();
  gateway.commitSave.mockRejectedValueOnce(new Error("storage unavailable"));
  click("预览保存");
  await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("确认保存");
  await vi.waitFor(() => expect(document.body.textContent).toContain("storage unavailable"));
  switchTarget();
  click("确认保存");
  expect(gateway.commitSave).toHaveBeenCalledTimes(1);
});

it("offers exact saved-artifact navigation only after confirmed save and explicit click", async () => {
  const open = vi.fn(), { gateway } = setup("zh-CN", open);
  gateway.commitSave.mockResolvedValue({ artifact: { id: "saved-id" }, replayed: true });
  expect(document.body.textContent).not.toContain("查看已保存产物");
  click("预览保存"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  expect(gateway.commitSave).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  click("确认保存"); await vi.waitFor(() => expect(document.body.textContent).toContain("查看已保存产物"));
  expect(open).not.toHaveBeenCalled();
  click("查看已保存产物");
  expect(open).toHaveBeenCalledWith("saved-id", scope);
  expect(gateway.commitSave).toHaveBeenCalledTimes(1);
});

it("does not navigate from a stale saved-result button", async () => {
  const open = vi.fn(), { actions, gateway, switchTarget } = setup("en", open);
  gateway.commitSave.mockResolvedValue({ artifact: { id: "saved-id" } });
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

it("does not offer navigation after a failed save or an invalid artifact identifier", async () => {
  const open = vi.fn(), { gateway } = setup("en", open);
  gateway.commitSave.mockRejectedValueOnce(new Error("storage unavailable"));
  click("Preview save"); await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("storage unavailable"));
  expect(document.body.textContent).not.toContain("View saved artifact");
  gateway.commitSave.mockResolvedValue({ artifact: { id: {} } });
  click("Confirm save"); await vi.waitFor(() => expect(document.body.textContent).toContain("Saved to the current workspace artifacts."));
  expect(document.body.textContent).not.toContain("View saved artifact"); expect(open).not.toHaveBeenCalled();
});
