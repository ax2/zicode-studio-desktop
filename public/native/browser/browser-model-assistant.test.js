import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { setLocale } from "../../i18n.js";
import { createBrowserAnalysisArtifacts } from "./browser-analysis-artifact.js";
import { createBrowserModelAssistant } from "./browser-model-assistant.js";
import { createBrowserModelGateway } from "./browser-model-gateway.js";
import { showBrowserCapture } from "./browser-capture-preview.js";

const a = { provider: "fixture", modelId: "a", name: "A", fingerprint: "a".repeat(64) };
const b = { provider: "fixture", modelId: "b", name: "B", fingerprint: "b".repeat(64), supportsImages: true };
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

it("keeps the previous reviewed answer and its original model saveable when a model change fails", async () => {
  const artifacts = { save: vi.fn(async () => ({ id: "original-answer" })), open: vi.fn() };
  const f = fixture(true, artifacts);
  f.actions.ask.mockResolvedValueOnce({ text: "Existing A answer", model: a });
  await waitFor(() => expect(getByRole(f.el, "combobox").disabled).toBe(false));
  fireEvent.click(getByRole(f.el, "button", { name: "Send page and ask" }));
  await waitFor(() => expect(getByRole(f.el, "textbox", { name: "Browser model answer" }).value).toBe("Existing A answer"));
  const answer = getByRole(f.el, "textbox", { name: "Browser model answer" });
  f.actions.save.mockRejectedValueOnce(new Error("module_model_config_changed"));
  fireEvent.change(getByRole(f.el, "combobox"), { target: { value: JSON.stringify(["fixture", "b"]) } });
  await waitFor(() => expect(f.el.textContent).toContain("Model configuration changed."));
  expect(getByRole(f.el, "combobox").value).toBe("");
  expect(answer.hidden).toBe(false);
  expect(answer.value).toBe("Existing A answer");
  const save = getByRole(f.el, "button", { name: "Save analysis to Artifacts" });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(artifacts.save).toHaveBeenCalledOnce());
  expect(artifacts.save.mock.calls[0][0]).toMatchObject({ text: "Existing A answer", model: a, question: "What does this page say?" });
  expect(f.actions.ask).toHaveBeenCalledOnce();
  fireEvent.change(getByRole(f.el, "combobox"), { target: { value: JSON.stringify(["fixture", "b"]) } });
  await waitFor(() => expect(answer.hidden).toBe(true));
  expect(answer.value).toBe("");
  expect(f.el.querySelector('button[data-i18n-text="Open saved artifact"]').hidden).toBe(true);
});


const reviewedImage = {
  pngBase64: "iVBORw0K",
  source: { url: "https://assets.example.org/pixel.png", alt: "Fixture", width: 20, height: 30 },
  pageUrl: "https://example.org/page", capturedAt: "2026-11-24T00:00:00Z", documentRevision: "main-r1",
  frame: { url: "https://example.org/frame", title: "Embedded", documentRevision: "1000" },
};

async function selectVision(f) {
  const select = getByRole(f.el, "combobox");
  await waitFor(() => expect(select.disabled).toBe(false));
  fireEvent.change(select, { target: { value: JSON.stringify(["fixture", "b"]) } });
  await waitFor(() => expect(select.disabled).toBe(false));
}

it("keeps the reviewed image result and saved artifact through cancellation and timeout, then replaces them after a successful retry", async () => {
  const artifacts = { save: vi.fn(async () => ({ id: "reviewed-artifact" })), open: vi.fn() };
  const f = fixture(true, artifacts);
  await selectVision(f);
  f.actions.ask.mockResolvedValueOnce({ text: "Reviewed image answer", model: b });
  await f.controller.reviewImage(async () => reviewedImage);
  fireEvent.click(getByRole(f.el, "button", { name: "Send only this image" }));
  const answer = await waitFor(() => getByRole(f.el, "textbox", { name: "Browser model answer" }));
  expect(answer.value).toBe("Reviewed image answer");
  const save = getByRole(f.el, "button", { name: "Save analysis to Artifacts" });
  fireEvent.click(save);
  const open = await waitFor(() => getByRole(f.el, "button", { name: "Open saved artifact" }));
  expect(artifacts.save.mock.calls[0][0]).toMatchObject({ kind: "image", image: { frame: reviewedImage.frame } });

  const send = getByRole(f.el, "button", { name: "Send page and ask" });
  const imageSource = f.el.querySelector(".browser-image-result-source");
  f.question.value = "Question to keep on retry";
  let finish;
  f.actions.ask.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(send);
  fireEvent.click(getByRole(f.el, "button", { name: "Cancel model request" }));
  const duringRequest = answer.value;
  const disabledDuringRequest = open.disabled;
  finish({ text: "Late cancelled response", model: a });
  await waitFor(() => expect(f.el.textContent).toContain("Model request cancelled."));
  expect(f.actions.cancel).toHaveBeenCalledWith(f.actions.ask.mock.calls[1][0].requestId);
  expect(duringRequest).toBe("Reviewed image answer");
  expect(disabledDuringRequest).toBe(true);
  expect(open.disabled).toBe(false);
  expect(imageSource.textContent).toContain(reviewedImage.frame.documentRevision);

  f.actions.ask.mockRejectedValueOnce(new Error("module_model_request_timeout"));
  fireEvent.click(send);
  await waitFor(() => expect(f.el.textContent).toContain("The model request timed out."));
  expect(f.question.value).toBe("Question to keep on retry");
  expect(answer.hidden).toBe(false);
  expect(answer.value).toBe("Reviewed image answer");
  expect(imageSource.hidden).toBe(false);
  expect(f.el.textContent).toContain("fixture / B");
  fireEvent.click(open);
  expect(artifacts.open).toHaveBeenCalledWith({ id: "reviewed-artifact" });
  expect(artifacts.save).toHaveBeenCalledOnce();

  f.actions.ask.mockResolvedValueOnce({ text: "Replacement page answer", model: b });
  fireEvent.click(send);
  await waitFor(() => expect(answer.value).toBe("Replacement page answer"));
  expect(imageSource.hidden).toBe(true);
  expect(open.hidden).toBe(true);
  expect(save.disabled).toBe(false);
  expect(f.actions.ask).toHaveBeenCalledTimes(4);
});


it("reviews only the clicked embedded image, sends on separate confirmation and retains local source details", async () => {
  setLocale("en");
  const details = reviewedImage.frame;
  const locator = { path: [0], timeOrigin: details.documentRevision };
  const snapshot = { tab: "local", documentRevision: reviewedImage.documentRevision, capturedAt: reviewedImage.capturedAt,
    page: { title: "Main", url: reviewedImage.pageUrl, text: "Private page fixture",
      images: [{ ...reviewedImage.source, url: "https://example.org/different.png" }],
      frames: [{ ...details, text: "Frame fixture", images: [reviewedImage.source], imageLocator: locator }] } };
  const host = document.createElement("aside");
  const trigger = document.createElement("button");
  document.body.append(trigger, host);
  const actions = {
    autoLoad: () => true, load: vi.fn(async () => state({ provider: "fixture", modelId: "b" })),
    ask: vi.fn(async () => ({ text: "Visual fixture answer.", model: b })), cancel: vi.fn(),
  };
  const previewImage = vi.fn(async () => reviewedImage);
  const artifact = { id: "saved-image-analysis" };
  const target = { sceneId: "programming", workspaceId: "11111111-1111-4111-8111-111111111111" };
  const gateway = { create: vi.fn().mockRejectedValueOnce(Error("Disk full")).mockResolvedValue({ artifact }) };
  const analysisArtifacts = createBrowserAnalysisArtifacts({
    capture: snapshot, getTarget: () => target, isCurrent: () => host.isConnected, gateway,
  });
  const onOpen = vi.fn();
  window.addEventListener("zicode:open-artifact", onOpen);
  const dialog = showBrowserCapture(snapshot, vi.fn(), undefined, undefined, undefined, false,
    { host, trigger, modelActions: actions, previewImage, analysisArtifacts });
  try {
    await waitFor(() => expect(getByRole(dialog, "combobox").disabled).toBe(false));
    expect(previewImage).not.toHaveBeenCalled();
    expect(actions.ask).not.toHaveBeenCalled();
    expect(queryByRole(dialog, "button", { name: "Save analysis to Artifacts" })).toBeNull();
    expect(queryByRole(dialog, "button", { name: "Open saved artifact" })).toBeNull();
    expect(dialog.querySelector('[data-i18n-text="Save analysis to Artifacts"]').classList.contains("hidden")).toBe(true);
    const parent = dialog.querySelector(".browser-capture-frames");
    parent.open = true;
    parent.querySelector("details").open = true;
    fireEvent.click(getByRole(parent, "button", { name: "Preview image for AI" }));
    await waitFor(() => expect(getByRole(dialog, "img").getAttribute("src")).toBe("data:image/png;base64,iVBORw0K"));
    expect(previewImage).toHaveBeenCalledWith(reviewedImage.source, { title: details.title, url: details.url, locator });
    expect(previewImage).toHaveBeenCalledOnce();
    expect(actions.ask).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("Image destination: fixture / B");
    expect(queryByRole(dialog, "button", { name: "Save analysis to Artifacts" })).toBeNull();
    fireEvent.click(getByRole(dialog, "button", { name: "Send only this image" }));
    await waitFor(() => expect(getByRole(dialog, "textbox", { name: "Browser model answer" }).value).toBe("Visual fixture answer."));
    expect(previewImage).toHaveBeenCalledTimes(2);
    expect(actions.ask).toHaveBeenCalledOnce();
    expect(actions.ask.mock.calls[0][0]).toEqual({
      requestId: expect.any(String), confirmed: true, expectedRevision: "override", expectedModelFingerprint: b.fingerprint,
      prompt: "Describe the visible content of this image.", image: reviewedImage.pngBase64,
    });
    const result = dialog.querySelector(".browser-image-result-source");
    for (const value of [reviewedImage.pageUrl, reviewedImage.source.url, reviewedImage.capturedAt, reviewedImage.documentRevision, details.url, details.documentRevision]) {
      expect(result.textContent).toContain(value);
    }
    expect(dialog.querySelector(".browser-image-review img").hasAttribute("src")).toBe(false);
    const save = getByRole(dialog, "button", { name: "Save analysis to Artifacts" });
    expect(save.classList.contains("hidden")).toBe(false);
    expect(gateway.create).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(dialog.textContent).toContain("Could not save analysis. Try again."));
    expect(getByRole(dialog, "textbox", { name: "Browser model answer" }).value).toBe("Visual fixture answer.");
    expect(result.textContent).toContain(details.documentRevision);
    fireEvent.click(save);
    const open = await waitFor(() => getByRole(dialog, "button", { name: "Open saved artifact" }));
    expect(gateway.create).toHaveBeenCalledTimes(2);
    expect(gateway.create.mock.calls[1]).toEqual(gateway.create.mock.calls[0]);
    const [sceneId, workspaceId, draft] = gateway.create.mock.calls[0];
    expect({ sceneId, workspaceId }).toEqual(target);
    expect(draft).toMatchObject({ mimeType: "text/plain", provenance: {
      source: { url: reviewedImage.pageUrl, documentRevision: reviewedImage.documentRevision,
        capturedAt: reviewedImage.capturedAt, image: { url: reviewedImage.source.url }, frame: details },
      analysis: { kind: "image", model: { provider: b.provider, modelId: b.modelId }, generatedAt: expect.any(String) },
    } });
    expect(draft.content).toContain("Visual fixture answer.");
    expect(JSON.stringify(draft)).not.toContain(reviewedImage.pngBase64);
    expect(JSON.stringify(draft)).not.toContain("Private page fixture");
    expect(JSON.stringify(draft)).not.toContain("Frame fixture");
    fireEvent.click(open);
    expect(onOpen.mock.calls[0][0].detail).toEqual({ artifactId: artifact.id, ...target });
    expect(previewImage).toHaveBeenCalledTimes(2);
    expect(actions.ask).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("zicode:open-artifact", onOpen);
    dialog.disposeBrowserModel();
  }
});

it("leaves image sending disabled for a text-only model without falling back to a page request", async () => {
  const f = fixture();
  await waitFor(() => expect(getByRole(f.el, "combobox").disabled).toBe(false));
  const read = vi.fn(async () => reviewedImage);
  await f.controller.reviewImage(read);
  const send = getByRole(f.el, "button", { name: "Send only this image" });
  expect(send.disabled).toBe(true);
  expect(f.el.textContent).toContain("Use a browser model that supports images.");
  fireEvent.click(send);
  expect(read).toHaveBeenCalledOnce();
  expect(f.actions.ask).not.toHaveBeenCalled();
  expect(f.prompt).not.toHaveBeenCalled();
});

it("discards a changed frame before an authorized image can reach the selected model", async () => {
  const f = fixture();
  await selectVision(f);
  const read = vi.fn().mockResolvedValueOnce(reviewedImage).mockResolvedValue({
    ...reviewedImage, frame: { ...reviewedImage.frame, documentRevision: "replaced-frame" },
  });
  await f.controller.reviewImage(read);
  fireEvent.click(getByRole(f.el, "button", { name: "Send only this image" }));
  await waitFor(() => expect(f.el.textContent).toContain("The image changed. Preview it again."));
  expect(read).toHaveBeenCalledTimes(2);
  expect(f.actions.ask).not.toHaveBeenCalled();
  expect(f.el.querySelector(".browser-image-review").hidden).toBe(true);
});

it("cancels during local validation without invoking a provider", async () => {
  const f = fixture();
  await selectVision(f);
  let finish;
  const read = vi.fn().mockResolvedValueOnce(reviewedImage).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await f.controller.reviewImage(read);
  fireEvent.click(getByRole(f.el, "button", { name: "Send only this image" }));
  fireEvent.click(getByRole(f.el, "button", { name: "Cancel model request" }));
  finish(reviewedImage);
  await waitFor(() => expect(f.el.textContent).toContain("Model request cancelled."));
  expect(f.actions.ask).not.toHaveBeenCalled();
  expect(f.actions.cancel).not.toHaveBeenCalled();
});
