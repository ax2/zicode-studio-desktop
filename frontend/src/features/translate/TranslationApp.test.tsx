import { createServer } from "node:http";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { TranslationMain } from "./TranslationApp";
import { createTranslationStore, type TranslationGateway, TranslationHttpGateway } from "./translationStore";

function stubGateway(
  overrides: Partial<TranslationGateway> = {},
): TranslationGateway {
  return {
    translate: vi.fn(async () => ({
      translated: "你好",
      model: "deepseek-v4-flash",
      targetLang: "中文",
      charCount: 2,
    })),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("translate composer", () => {
  it("shows the first-run guide until dismissed", () => {
    localStorage.clear();
    const store = createTranslationStore({
      gateway: stubGateway(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    store.getState().setModelSelection({ sceneId: "programming", provider: "local", model: "example" });
    const { container } = render(<TranslationMain store={store} />);
    expect(container.querySelector("[data-first-run-guide]")).toBeTruthy();
    expect(container.textContent).toContain("开始翻译");
  });

  it("imports clipboard text through the workbench and asks before replacing a draft", async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const readText = vi.fn(async () => "Text from another application");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    const gateway = stubGateway();
    const store = createTranslationStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    try {
      const view = render(<TranslationMain store={store} />);
      const draft = view.getByRole("textbox", { name: t("Source text") }) as HTMLTextAreaElement;
      const click = (label: string) => fireEvent.click(view.getByRole("button", { name: t(label) }));
      fireEvent.change(draft, { target: { value: "Keep this draft" } });
      expect(readText).not.toHaveBeenCalled();

      click("Import from clipboard");
      const preview = await view.findByRole("textbox", { name: t("Clipboard text") }) as HTMLTextAreaElement;
      expect(preview.value).toBe("Text from another application");
      expect(draft.value).toBe("Keep this draft");
      click("Keep current draft");
      expect(view.queryByRole("textbox", { name: t("Clipboard text") })).toBeNull();
      expect(draft.value).toBe("Keep this draft");

      click("Import from clipboard");
      await view.findByRole("textbox", { name: t("Clipboard text") });
      click("Use clipboard text");
      expect(draft.value).toBe("Text from another application");
      expect(readText).toHaveBeenCalledTimes(2);
      expect(gateway.translate).not.toHaveBeenCalled();
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("runs translation with Ctrl+Enter", async () => {
    const gateway = stubGateway();
    const store = createTranslationStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    store.getState().setModelSelection({ sceneId: "programming", provider: "local", model: "example" });
    const { container } = render(<TranslationMain store={store} />);

    const textarea = container.querySelector(
      ".translate-textarea",
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "hello");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await waitFor(() => expect(gateway.translate).toHaveBeenCalled());
  });

  it("keeps the draft through a cancelled HTTP request and a failure, then copies an explicit retry", async () => {
    const requests: Record<string, unknown>[] = [];
    let disconnected = false;
    const server = createServer((request, response) => {
      const reply = (value: unknown, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url?.startsWith("/v2/model-tools/models?")) {
        reply({ models: [{ provider: "fixture", model: "text", name: "Loopback", endpoint: "127.0.0.1", requiresKey: false }] });
        return;
      }
      if (request.url !== "/v2/translate" || request.method !== "POST") {
        reply({}, 404);
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requests.push(JSON.parse(body));
        if (requests.length === 1) {
          response.once("close", () => { disconnected = !response.writableFinished; });
        } else if (requests.length === 2) {
          reply({ error: { code: "model_request_failed" } }, 502);
        } else {
          reply({ provider: "fixture", model: "text", translated: "测试文字", targetLang: "Chinese", sourceLang: "English", charCount: 4 });
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn(async () => {});
    const readText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText, readText } });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing loopback address");
      const origin = `http://127.0.0.1:${address.port}`;
      const store = createTranslationStore({
        gateway: new TranslationHttpGateway({ location: { origin } as Location }),
        getTarget: () => ({ sceneId: "programming", workspaceId: "fixture" }),
        notify: vi.fn(),
      });
      const view = render(<TranslationMain store={store} />);
      const model = view.getByRole("combobox", { name: t("Model service") });
      const draft = view.getByRole("textbox", { name: t("Source text") }) as HTMLTextAreaElement;
      const click = (label: string) => fireEvent.click(view.getByRole("button", { name: t(label) }));
      await view.findByRole("option", { name: "fixture / Loopback" });
      fireEvent.change(draft, { target: { value: "Please keep this draft." } });
      click("Translate");
      expect(view.getByRole("alert").textContent).toBe(t("Choose a configured model"));
      expect(requests).toHaveLength(0);
      fireEvent.change(model, { target: { value: "0" } });
      expect(requests).toHaveLength(0);
      click("Translate");
      await waitFor(() => expect(requests).toHaveLength(1));
      click("Cancel");
      await waitFor(() => expect(disconnected).toBe(true));
      expect(draft.value).toBe("Please keep this draft.");
      expect(requests).toHaveLength(1);

      click("Try again");
      await view.findByRole("alert");
      expect(draft.value).toBe("Please keep this draft.");
      expect(requests).toHaveLength(2);
      click("Try again");
      const result = await view.findByRole("textbox", { name: t("Result") }) as HTMLTextAreaElement;
      expect(result.value).toBe("测试文字");
      expect(requests).toHaveLength(3);
      for (const payload of requests) {
        expect(payload).toMatchObject({ text: draft.value, targetLang: "Chinese", provider: "fixture", model: "text" });
      }
      click("Copy");
      expect(writeText).toHaveBeenCalledExactlyOnceWith("测试文字");
      expect(readText).not.toHaveBeenCalled();
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
