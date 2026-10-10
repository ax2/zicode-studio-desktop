import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TranslationMain } from "../features/translate/TranslationApp";
import {
  createTranslationStore,
  TranslationHttpGateway,
} from "../features/translate/translationStore";
import { setLocale } from "./i18n";
import { ModelToolPicker } from "./ModelToolPicker";

const choice = {
  provider: "local",
  model: "local-model",
  name: "Local model",
  endpoint: "http://127.0.0.1:11434",
  requiresKey: false,
};
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("requires an explicit choice and sends only that scene/provider/model on translation", async () => {
  setLocale("en");
  const gateway = {
    listModels: vi.fn(async () => [choice]),
    translate: vi.fn(async () => ({
      translated: "你好",
      model: choice.model,
      targetLang: "Chinese",
      charCount: 2,
    })),
  };
  let sceneId = "programming";
  const store = createTranslationStore({
    gateway,
    getTarget: () => ({ sceneId, workspaceId: "workspace" }),
    notify: vi.fn(),
  });
  store.getState().setText("hello");
  await store.getState().run();
  expect(gateway.translate).not.toHaveBeenCalled();
  render(<TranslationMain store={store} />);
  await screen.findByRole("option", { name: "local / Local model" });
  fireEvent.change(screen.getByRole("combobox", { name: "Model service" }), {
    target: { value: "0" },
  });
  expect(screen.getByText(/http:\/\/127.0.0.1:11434/)).toBeTruthy();
  await act(async () => {
    await store.getState().run();
  });
  expect(gateway.translate).toHaveBeenCalledWith(
    { sceneId: "programming", workspaceId: "workspace" },
    expect.objectContaining({ provider: "local", model: "local-model", text: "hello" }),
  );
  sceneId = "finance";
  await act(async () => {
    await store.getState().run();
  });
  expect(gateway.translate).toHaveBeenCalledTimes(1);
});

it("discards late model catalogs after a scene change and supports refreshing an empty list", async () => {
  setLocale("en");
  let finish: (items: (typeof choice)[]) => void = () => {};
  const old = new Promise<(typeof choice)[]>((resolve) => {
    finish = resolve;
  });
  const load = vi.fn().mockReturnValueOnce(old).mockResolvedValue([]);
  const onChange = vi.fn();
  const { rerender } = render(
    <ModelToolPicker sceneId="a" value={null} onChange={onChange} load={load} />,
  );
  rerender(<ModelToolPicker sceneId="b" value={null} onChange={onChange} load={load} />);
  await waitFor(() => expect(screen.getByText(/Add an OpenAI-compatible/)).toBeTruthy());
  await act(async () => {
    finish([choice]);
  });
  expect(screen.queryByRole("option", { name: "local / Local model" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  expect(onChange).toHaveBeenCalledWith(null);
});

it("keeps configured model queries separate from text submission", async () => {
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ models: [choice] }), { status: 200 }),
  );
  const gateway = new TranslationHttpGateway({
    fetchImpl,
    location: { origin: "http://localhost" } as Location,
  });
  await gateway.listModels({ sceneId: "my scene", workspaceId: "w" });
  expect(fetchImpl.mock.calls[0][0]).toBe(
    "http://localhost/v2/model-tools/models?sceneId=my+scene&purpose=translation",
  );
  await gateway.translate(
    { sceneId: "my scene", workspaceId: "w" },
    { text: "private text", targetLang: "Chinese", provider: "local", model: "local-model" },
  );
  const init = fetchImpl.mock.calls[1][1] as RequestInit;
  expect(JSON.parse(String(init.body))).toMatchObject({
    provider: "local",
    model: "local-model",
    sceneId: "my scene",
  });
});
