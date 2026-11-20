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
