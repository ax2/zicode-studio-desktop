import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { setupChatPluginResultActions } from "./chat-plugin-result-actions.js";

const resultId = "22222222-2222-4222-8222-222222222222";
const detail = { result: { ok: true, data: { text: "SELECT 1" } },
  resultRef: { schemaVersion: 1, resultId, mimeType: "text/plain" },
  pluginId: "com.zicode.devtools.text", capabilityId: "sql.format" };

afterEach(() => document.body.replaceChildren());

it("opens the trusted result actions for a captured Pi output", async () => {
  setLocale("en");
  const messages = document.createElement("div");
  document.body.append(messages);
  let target = { instanceId: "instance", sessionId: "session", workspaceId: "workspace", sceneId: "programming" };
  const gateway = {
    prepareSave: vi.fn(async () => ({ grantId: "grant", preview: { title: "SQL result", text: "SELECT 1",
      byteLength: 8, packageVersion: "0.3.0", workspaceId: "workspace" } })),
    commitSave: vi.fn(),
  };
  const actions = setupChatPluginResultActions({ messages, gateway, getTarget: () => target });
  messages.dispatchEvent(new CustomEvent("pluginresultaction", { detail }));
  expect(document.querySelector(".chat-plugin-result-holder")?.hidden).toBe(false);
  expect(document.body.textContent).toContain("Preview save");
  const preview = [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview save");
  preview.click();
  await vi.waitFor(() => expect(gateway.prepareSave).toHaveBeenCalledWith(
    { workspaceId: "workspace", sceneId: "programming", pluginId: detail.pluginId,
      capabilityId: detail.capabilityId }, resultId, expect.any(String)));
  expect(gateway.commitSave).not.toHaveBeenCalled();
  target = { ...target, sessionId: "other" };
  const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm save");
  confirm.click();
  expect(gateway.commitSave).not.toHaveBeenCalled();
  actions.destroy();
});

it("rejects malformed or failed result events", () => {
  setLocale("en");
  const messages = document.createElement("div");
  document.body.append(messages);
  const gateway = { prepareSave: vi.fn(), commitSave: vi.fn() };
  const actions = setupChatPluginResultActions({ messages, gateway, getTarget: () => ({
    instanceId: "instance", sessionId: "session", workspaceId: "workspace" }) });
  messages.dispatchEvent(new CustomEvent("pluginresultaction", { detail: { ...detail,
    result: { ok: false } } }));
  messages.dispatchEvent(new CustomEvent("pluginresultaction", { detail: { ...detail,
    resultRef: { ...detail.resultRef, resultId: "forged" } } }));
  expect(document.querySelector(".chat-plugin-result-holder")?.hidden).toBe(true);
  expect(gateway.prepareSave).not.toHaveBeenCalled();
  actions.destroy();
});

it("accepts a versioned JSON object result but rejects a mismatched MIME", async () => {
  setLocale("en");
  const messages = document.createElement("div");
  document.body.append(messages);
  const gateway = { prepareSave: vi.fn(async () => ({ grantId: "json-grant", preview: {
    title: "JSON", text: '{"count":2}', mimeType: "application/json",
    byteLength: 11, packageVersion: "1", workspaceId: "workspace" } })), commitSave: vi.fn() };
  const actions = setupChatPluginResultActions({ messages, gateway, getTarget: () => ({
    instanceId: "instance", sessionId: "session", workspaceId: "workspace" }) });
  const jsonDetail = { ...detail, result: { ok: true, data: { count: 2 } },
    resultRef: { schemaVersion: 2, resultId, mimeType: "application/json" } };
  messages.dispatchEvent(new CustomEvent("pluginresultaction", { detail: {
    ...jsonDetail, resultRef: { ...jsonDetail.resultRef, mimeType: "text/plain" } } }));
  expect(document.querySelector(".chat-plugin-result-holder")?.hidden).toBe(true);
  messages.dispatchEvent(new CustomEvent("pluginresultaction", { detail: jsonDetail }));
  expect(document.querySelector(".chat-plugin-result-holder")?.hidden).toBe(false);
  [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview save").click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("saved as application/json"));
  expect(gateway.commitSave).not.toHaveBeenCalled();
  actions.destroy();
});

it("routes a Pi result through receiver preview and explicit confirmation", async () => {
  setLocale("en");
  const messages = document.createElement("div");
  document.body.append(messages);
  const target = { instanceId: "instance", sessionId: "session", workspaceId: "workspace" };
  const gateway = {
    prepareSave: vi.fn(), commitSave: vi.fn(),
    searchTargets: vi.fn(async () => ({ items: [{ pluginId: "receiver", capabilityId: "base64.encode",
      title: "Base64", field: "text" }], total: 1, revision: "r", nextOffset: null })),
    prepareTransfer: vi.fn(async () => ({ grantId: "grant", preview: { text: "SELECT 1",
      target: { pluginId: "receiver", packageVersion: "1" }, field: "text",
      byteLength: 8, workspaceId: "workspace" } })),
    commitTransfer: vi.fn(async () => ({ result: { ok: true, data: { text: "U0VMRUNUIDE=" } },
      resultRef: { resultId: "33333333-3333-4333-8333-333333333333" }, replayed: false })),
  };
  const actions = setupChatPluginResultActions({ messages, gateway, getTarget: () => target });
  messages.dispatchEvent(new CustomEvent("pluginresultaction", { detail }));
  [...document.querySelectorAll("button")].find((button) => button.textContent === "Send to tool").click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Base64"));
  [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Base64")).click();
  await vi.waitFor(() => expect(gateway.prepareTransfer).toHaveBeenCalledWith(
    { workspaceId: "workspace", sceneId: "programming", pluginId: detail.pluginId,
      capabilityId: detail.capabilityId }, resultId,
    { pluginId: "receiver", capabilityId: "base64.encode" }, "text", {}));
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
  [...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm transfer and run").click();
  await vi.waitFor(() => expect(gateway.commitTransfer).toHaveBeenCalledWith(
    { workspaceId: "workspace", sceneId: "programming", pluginId: detail.pluginId,
      capabilityId: detail.capabilityId }, "grant"));
  actions.destroy();
});

it("discards an in-flight preview after the user closes the result panel", async () => {
  setLocale("en");
  const messages = document.createElement("div");
  document.body.append(messages);
  let resolvePreview;
  const gateway = { prepareSave: vi.fn(() => new Promise((resolve) => { resolvePreview = resolve; })),
    commitSave: vi.fn() };
  const actions = setupChatPluginResultActions({ messages, gateway, getTarget: () => ({
    instanceId: "instance", sessionId: "session", workspaceId: "workspace" }) });
  messages.dispatchEvent(new CustomEvent("pluginresultaction", { detail }));
  [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview save").click();
  expect(gateway.prepareSave).toHaveBeenCalledOnce();
  [...document.querySelectorAll("button")].find((button) => button.textContent === "Close").click();
  resolvePreview({ grantId: "stale", preview: { title: "stale", text: "stale" } });
  await Promise.resolve();
  expect(document.querySelector(".chat-plugin-result-holder")?.hidden).toBe(true);
  expect(document.body.textContent).not.toContain("Confirm save");
  expect(gateway.commitSave).not.toHaveBeenCalled();
  actions.destroy();
});
