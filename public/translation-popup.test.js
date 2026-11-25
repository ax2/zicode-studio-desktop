import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.replaceChildren();
});

it("keeps the newest popup response and sends only its revision when opening the workbench", async () => {
  const markup = readFileSync("public/translation-popup.html", "utf8");
  const fixture = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(fixture.querySelector("main"));
  const snapshot = (revision, translated) => ({
    locale: "en", languages: ["Chinese", "English"], service: { destination: "http://127.0.0.1:7777", local: true },
    popup: { revision, status: translated ? "done" : "running", message: "",
      draft: { text: `fixture ${revision}`, sourceLang: "English", targetLang: "Chinese", result: translated ? { translated } : null } },
  });
  const invoke = vi.fn()
    .mockResolvedValueOnce(snapshot(1))
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(snapshot(3, "Latest result"))
    .mockResolvedValue(undefined);
  let receive, finishOld;
  const listen = vi.fn(async (_event, callback) => { receive = callback; });
  vi.stubGlobal("__TAURI__", { core: { invoke }, window: { getCurrentWindow: () => ({ listen }) } });
  await import("./translation-popup.js");
  expect(listen).toHaveBeenCalledWith("studio-clipboard-translation-changed", expect.any(Function));
  expect(document.getElementById("status").textContent).toBe("Translating…");
  receive();
  receive();
  await vi.waitFor(() => expect(document.getElementById("result").value).toBe("Latest result"));
  finishOld(snapshot(2, "Previous result"));
  await Promise.resolve();
  expect(document.getElementById("source-text").value).toBe("fixture 3");
  expect(document.getElementById("result").value).toBe("Latest result");
  document.getElementById("workbench").click();
  expect(invoke).toHaveBeenLastCalledWith("clipboard_translation", { request: { kind: "workbench", revision: 3 } });
});

it("keeps retry focus, ignores duplicate activation, and retries only the current revision", async () => {
  const markup = readFileSync("public/translation-popup.html", "utf8");
  const fixture = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(fixture.querySelector("main"));
  const draft = { text: "fixture", sourceLang: "English", targetLang: "Chinese", result: null };
  let popup = { revision: 17, status: "ready", message: "", draft };
  let receive, rejectFirst;
  const retryTranslation = vi.fn()
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
    .mockRejectedValueOnce(new Error("Current request failed"));
  const invoke = vi.fn(async (_command, { request }) => {
    if (request.kind === "retry") return retryTranslation(request);
    return { locale: "en", languages: ["English", "Chinese"], service: { destination: "fixture", local: true }, popup };
  });
  const listen = vi.fn(async (_event, callback) => { receive = callback; });
  vi.stubGlobal("__TAURI__", { core: { invoke }, window: { getCurrentWindow: () => ({ listen }) } });
  await import("./translation-popup.js");

  const retry = document.getElementById("retry");
  const close = document.getElementById("close");
  const status = document.getElementById("status");
  retry.focus();
  retry.click();
  retry.click();
  expect(retryTranslation).toHaveBeenCalledExactlyOnceWith({ kind: "retry", revision: 17, source: "English", target: "Chinese" });
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(retry.disabled).toBe(false);
  expect(document.activeElement).toBe(retry);

  popup = { revision: 18, status: "running", message: "", draft };
  receive();
  await vi.waitFor(() => expect(status.textContent).toBe("Translating…"));
  retry.click();
  expect(retryTranslation).toHaveBeenCalledTimes(1);
  close.focus();

  popup = { revision: 19, status: "ready", message: "Synthetic provider error", draft };
  receive();
  await vi.waitFor(() => expect(retry.getAttribute("aria-disabled")).toBe("false"));
  expect(document.activeElement).toBe(close);
  rejectFirst(new Error("Older acknowledgment failed"));
  await Promise.resolve();
  expect(status.textContent).toBe("Synthetic provider error");

  retry.focus();
  retry.click();
  expect(retryTranslation).toHaveBeenLastCalledWith({ kind: "retry", revision: 19, source: "English", target: "Chinese" });
  await vi.waitFor(() => expect(status.textContent).toBe("Current request failed"));
  expect(retry.getAttribute("aria-disabled")).toBe("false");
  expect(document.activeElement).toBe(retry);
});

it("moves focus only when a new snapshot hides or disables the active popup control", async () => {
  const markup = readFileSync("public/translation-popup.html", "utf8");
  const fixture = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(fixture.querySelector("main"));
  const draft = { text: "old source", sourceLang: "English", targetLang: "Chinese", result: { translated: "old result" } };
  let popup = { revision: 1, status: "done", message: "", draft };
  let listen;
  const invoke = vi.fn(async () => ({
    locale: "en", languages: ["English", "Chinese"], service: { destination: "fixture", local: true }, popup,
  }));
  vi.stubGlobal("__TAURI__", { core: { invoke }, window: { getCurrentWindow: () => ({
    listen: async (_event, receive) => { listen = receive; },
  }) } });
  await import("./translation-popup.js");

  const source = document.getElementById("source-text");
  const copy = document.getElementById("copy");
  const close = document.getElementById("close");
  copy.focus();
  popup = { revision: 2, status: "running", message: "", draft: { ...draft, text: "new source", result: null } };
  listen();
  await vi.waitFor(() => expect(document.activeElement).toBe(source));
  expect(source.value).toBe("new source");
  expect(copy.hidden).toBe(true);

  popup = { revision: 3, status: "empty", message: "", draft: { ...draft, text: "", result: null } };
  listen();
  await vi.waitFor(() => expect(document.activeElement).toBe(close));

  popup = { revision: 4, status: "done", message: "", draft };
  listen();
  await vi.waitFor(() => expect(copy.hidden).toBe(false));
  expect(document.activeElement).toBe(close);
  expect(invoke.mock.calls.map(([, { request }]) => request.kind)).toEqual(Array(4).fill("snapshot"));
});
