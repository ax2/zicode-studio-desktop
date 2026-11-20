import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import type { TranslationResult } from "./translationLogic";
import { createTranslationStore, type TranslationGateway, type TranslationScope, type TranslationStore } from "./translationStore";

const result: TranslationResult = { translated: "你好", model: "example", targetLang: "Chinese", charCount: 2 };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(gateway: TranslationGateway, getTarget: () => TranslationScope = () => ({ sceneId: "programming", workspaceId: "ws-1" })) {
  const notify = vi.fn();
  const store = createTranslationStore({ gateway, getTarget, notify });
  store.getState().setModelSelection({ sceneId: "programming", provider: "local", model: "example" });
  store.getState().setText("Hello");
  return { store, notify };
}
beforeEach(() => setLocale("en"));

it("does not replace newly entered text with an invisible old result when swapping", async () => {
  const { store } = fixture({ translate: async () => result });
  await store.getState().run();
  store.getState().setText("Keep this new writing");
  store.getState().swap();
  expect(store.getState().text).toBe("Keep this new writing");
  expect(store.getState().editedText).toBe("");
});

const changes: [string, (store: TranslationStore) => void][] = [
  ["text", store => store.getState().setText("New writing")],
  ["source language", store => store.getState().setSourceLang("Japanese")],
  ["target language", store => store.getState().setTargetLang("German")],
  ["swap", store => store.getState().swap()],
  ["clear", store => store.getState().clear()],
  ["model", store => store.getState().setModelSelection({ sceneId: "programming", provider: "other", model: "other" })],
  ["edit and undo back to the same text", store => { store.getState().setText("Hello!"); store.getState().setText("Hello"); }],
];
it.each(changes)("ignores an old completion after changing %s, then permits a new translation", async (_label, change) => {
  const pending = deferred<TranslationResult>();
  const translate = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...result, translated: "Fresh translation" });
  const { store, notify } = fixture({ translate });
  const work = store.getState().run();
  expect(store.getState().busy).toBe(true);
  change(store);
  const before = { text: store.getState().text, sourceLang: store.getState().sourceLang, targetLang: store.getState().targetLang };
  pending.resolve(result); await work;
  expect(store.getState().result).toBeNull();
  expect(store.getState().editedText).toBe("");
  expect(store.getState().busy).toBe(false);
  expect({ text: store.getState().text, sourceLang: store.getState().sourceLang, targetLang: store.getState().targetLang }).toEqual(before);
  expect(notify).not.toHaveBeenCalled();
  if (!store.getState().text.trim()) store.getState().setText("A new request");
  await store.getState().run();
  expect(store.getState().editedText).toBe("Fresh translation");
  expect(notify).toHaveBeenCalledTimes(1);
});

it.each(["success", "failure"] as const)("does not expose a late %s in another workspace within the same context", async outcome => {
  let target = { sceneId: "programming", workspaceId: "ws-1" };
  const pending = deferred<TranslationResult>();
  const { store, notify } = fixture({ translate: () => pending.promise }, () => target);
  const work = store.getState().run(); target = { ...target, workspaceId: "ws-2" };
  if (outcome === "success") pending.resolve(result); else pending.reject(new Error("old provider failure"));
  await work;
  expect(store.getState().result).toBeNull(); expect(store.getState().editedText).toBe("");
  expect(store.getState().error).toBe(""); expect(store.getState().busy).toBe(false);
  expect(notify).not.toHaveBeenCalled();
});

it("snapshots scope identity even when its caller mutates the returned object", async () => {
  const target = { sceneId: "programming", workspaceId: "ws-1" };
  const pending = deferred<TranslationResult>();
  const { store } = fixture({ translate: () => pending.promise }, () => target);
  const work = store.getState().run(); target.workspaceId = "ws-2"; pending.resolve(result); await work;
  expect(store.getState().result).toBeNull();
});

it("keeps a newer draft free of an obsolete provider error", async () => {
  const pending = deferred<TranslationResult>(); const { store } = fixture({ translate: () => pending.promise });
  const work = store.getState().run(); store.getState().setText("New writing"); pending.reject(new Error("old provider failure")); await work;
  expect(store.getState().text).toBe("New writing"); expect(store.getState().error).not.toContain("old provider failure");
  expect(store.getState().busy).toBe(false);
});

it.each(["source", "target"] as const)("preserves an edited previous result when changing %s language, without swapping stale output into the new request", async field => {
  const { store } = fixture({ translate: async () => result });
  await store.getState().run(); store.getState().setEditedText("My revised translation");
  if (field === "source") store.getState().setSourceLang("Japanese"); else store.getState().setTargetLang("German");
  expect(store.getState().editedText).toBe("My revised translation");
  expect(store.getState().result).not.toBeNull();
  store.getState().swap();
  expect(store.getState().text).toBe("Hello");
});
