import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { setLocale } from "../../i18n.js";
import { createBrowserModelAssistant } from "./browser-model-assistant.js";
import { createBrowserModelGateway } from "./browser-model-gateway.js";

const a = { provider: "fixture", modelId: "a", name: "A", fingerprint: "a".repeat(64) };
const b = { provider: "fixture", modelId: "b", name: "B", fingerprint: "b".repeat(64) };
const state = (selection = null) => ({ schemaVersion: 1, revision: selection ? "override" : "initial", browser: selection,
  currentPiModel: a, effectiveBrowserModel: selection ? b : a, models: [a, b] });
const controllers = [];
afterEach(() => { controllers.splice(0).forEach(controller => { controller.dispose(); }); document.body.replaceChildren(); setLocale("zh-CN"); vi.restoreAllMocks(); });

function fixture(autoLoad = true, artifacts) {
  setLocale("en");
  const question = document.createElement("textarea"); question.value = "What does this page say?";
  const actions = { autoLoad: () => autoLoad, load: vi.fn(async () => state()),
    save: vi.fn(async selection => state(selection)), ask: vi.fn(async () => ({ text: "<script>inert answer</script>", model: b, inherited: false, usage: { totalTokens: 5 } })), cancel: vi.fn(async () => {}) };
  const prompt = vi.fn(summary => summary ? "reviewed summary source" : `reviewed question: ${question.value}`);
  const setBusy = vi.fn();
  const controller = createBrowserModelAssistant({ actions, question, prompt, isCurrent: () => controller.element.isConnected, setBusy, artifacts });
  controllers.push(controller); document.body.append(question, controller.element);
  return { controller, actions, question, prompt, setBusy, el: controller.element };
}

it("does not start AI or send page contents when opening a tool-mode panel", async () => {
  const f = fixture(false);
  await Promise.resolve();
  expect(f.actions.load).not.toHaveBeenCalled();
  expect(f.actions.ask).not.toHaveBeenCalled();
  expect(getByRole(f.el, "button", { name: "Send page and ask" }).disabled).toBe(true);
  fireEvent.click(getByRole(f.el, "button", { name: "Load Pi models" }));
  await waitFor(() => expect(f.actions.load).toHaveBeenCalledOnce());
  await waitFor(() => expect(getByRole(f.el, "combobox").disabled).toBe(false));
  expect(f.actions.ask).not.toHaveBeenCalled();
});

it("keeps Pi as default, saves an independent reference and sends only after explicit click", async () => {
  const f = fixture();
  await waitFor(() => expect(getByRole(f.el, "combobox").disabled).toBe(false));
  const select = getByRole(f.el, "combobox");
  expect(select.value).toBe("");
  expect(select.options[0].textContent).toContain("Follow Pi — fixture / A");
  fireEvent.change(select, { target: { value: JSON.stringify(["fixture", "b"]) } });
  await waitFor(() => expect(f.actions.save).toHaveBeenCalledWith({ provider: "fixture", modelId: "b" }, "initial"));
  await waitFor(() => expect(select.disabled).toBe(false));
  expect(f.actions.ask).not.toHaveBeenCalled();
  fireEvent.click(getByRole(f.el, "button", { name: "Send page and ask" }));
  await waitFor(() => expect(f.actions.ask).toHaveBeenCalledOnce());
  expect(f.actions.ask.mock.calls[0][0]).toMatchObject({ confirmed: true, prompt: "reviewed question: What does this page say?", expectedRevision: "override", expectedModelFingerprint: b.fingerprint });
  await waitFor(() => expect(getByRole(f.el, "textbox", { name: "Browser model answer" }).value).toBe("<script>inert answer</script>"));
  expect(f.el.querySelector("script")).toBeNull();
  expect(f.el.textContent).toContain("fixture / B · 5 tokens");
});

it("retains selection after a save failure and cancels the exact in-flight request on disposal", async () => {
  const f = fixture();
  await waitFor(() => expect(getByRole(f.el, "combobox").disabled).toBe(false));
  f.actions.save.mockRejectedValueOnce(new Error("module_model_config_changed"));
  fireEvent.change(getByRole(f.el, "combobox"), { target: { value: JSON.stringify(["fixture", "b"]) } });
  await waitFor(() => expect(f.el.textContent).toContain("Model configuration changed."));
  expect(getByRole(f.el, "combobox").value).toBe("");
  let reject;
  f.actions.ask.mockImplementation(() => new Promise((_, failure) => { reject = failure; }));
  fireEvent.click(getByRole(f.el, "button", { name: "Send page and summarize" }));
  await waitFor(() => expect(f.actions.ask).toHaveBeenCalledOnce());
  const request = f.actions.ask.mock.calls[0][0];
  f.controller.dispose();
  expect(f.actions.cancel).toHaveBeenCalledWith(request.requestId);
  reject(new Error("module_model_request_cancelled"));
  await Promise.resolve();
  expect(f.el.querySelector("textarea").value).toBe("");
});

it("initializes Pi only on explicit load and binds all calls to that exact target", async () => {
  setLocale("en");
  const tools = { runtimeMode: "tools", workspaceId: "w", sceneId: "s", instanceId: "tools", sessionId: "tools-session" };
  const ai = { ...tools, runtimeMode: "ai", instanceId: "ai", sessionId: "ai-session" };
  let target = tools;
  const gateway = { call: vi.fn(async () => ({ ok: true, data: state() })) };
  const openConversation = vi.fn(async () => { target = ai; });
  const actions = createBrowserModelGateway({ gateway, getTarget: () => target, isCurrent: () => true, openConversation });
  expect(actions.autoLoad()).toBe(false);
  expect(openConversation).not.toHaveBeenCalled();
  await actions.load();
  expect(openConversation).toHaveBeenCalledOnce();
  expect(gateway.call).toHaveBeenCalledWith("get_module_models", {}, { target: ai, timeoutMs: 40000 });
  target = { ...ai, sessionId: "different" };
  await expect(actions.ask({ requestId: "owned" })).rejects.toThrow("Page or conversation changed");
  expect(gateway.call).toHaveBeenCalledOnce();
  await actions.cancel("owned");
  expect(gateway.call).toHaveBeenLastCalledWith("cancel_browser_model_request", { requestId: "owned" }, { target: ai });
});

it("saves an existing reviewed answer only after click, keeps it on failure and opens after retry without another model request", async () => {
  const artifacts = { save: vi.fn().mockRejectedValueOnce(Error("Disk full")).mockResolvedValue({ id: "saved-analysis" }), open: vi.fn() };
  const f = fixture(true, artifacts);
  await waitFor(() => expect(getByRole(f.el, "combobox").disabled).toBe(false));
  expect(artifacts.save).not.toHaveBeenCalled();
  fireEvent.click(getByRole(f.el, "button", { name: "Send page and ask" }));
  await waitFor(() => expect(getByRole(f.el, "textbox", { name: "Browser model answer" }).value).toBe("<script>inert answer</script>"));
  expect(artifacts.save).not.toHaveBeenCalled();
  fireEvent.click(getByRole(f.el, "button", { name: "Save analysis to Artifacts" }));
  await waitFor(() => expect(f.el.textContent).toContain("Could not save analysis. Try again."));
  expect(getByRole(f.el, "textbox", { name: "Browser model answer" }).value).toBe("<script>inert answer</script>");
  fireEvent.click(getByRole(f.el, "button", { name: "Save analysis to Artifacts" }));
  await waitFor(() => expect(f.el.textContent).toContain("Analysis saved to Artifacts"));
  expect(artifacts.save.mock.calls[0][0]).toMatchObject({ text: "<script>inert answer</script>", kind: "analysis", question: "What does this page say?", model: b });
  expect(Date.parse(artifacts.save.mock.calls[0][0].generatedAt)).toBeGreaterThan(0);
  expect(artifacts.save.mock.calls[1][0]).toBe(artifacts.save.mock.calls[0][0]);
  expect(getByRole(f.el, "button", { name: "Save analysis to Artifacts" }).disabled).toBe(true);
  fireEvent.click(getByRole(f.el, "button", { name: "Open saved artifact" }));
  expect(artifacts.open).toHaveBeenCalledWith({ id: "saved-analysis" });
  expect(f.actions.ask).toHaveBeenCalledOnce();
});

it("saves summary intent with its original result instead of treating a later question as the source", async () => {
  const artifacts = { save: vi.fn(async () => ({ id: "summary" })), open: vi.fn() };
  const f = fixture(true, artifacts);
  await waitFor(() => expect(getByRole(f.el, "combobox").disabled).toBe(false));
  fireEvent.click(getByRole(f.el, "button", { name: "Send page and summarize" }));
  await waitFor(() => expect(getByRole(f.el, "button", { name: "Save analysis to Artifacts" }).disabled).toBe(false));
  f.question.value = "A later unrelated question";
  fireEvent.click(getByRole(f.el, "button", { name: "Save analysis to Artifacts" }));
  await waitFor(() => expect(artifacts.save).toHaveBeenCalledOnce());
  expect(artifacts.save.mock.calls[0][0]).toMatchObject({ kind: "summary", question: "", text: "<script>inert answer</script>" });
  expect(f.actions.ask).toHaveBeenCalledOnce();
});
