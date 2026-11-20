import { act } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ChatFeed } from "./chatFeedStore";

let feed: ChatFeed | undefined;
afterEach(async () => {
  await act(async () => feed?.destroy()); feed = undefined;
  document.body.replaceChildren(); setLocale("zh-CN");
});

it("preserves user, completed and streaming message text when it matches interface labels", async () => {
  const container = document.createElement("div"); document.body.append(container);
  setLocale("zh-CN");
  await act(async () => {
    feed = new ChatFeed(container);
    feed.renderUserMessage({ content: "Settings" });
    feed.renderAssistantMessage({ id: "complete", content: "Tools" });
  });
  let handle: ReturnType<ChatFeed["renderAssistantMessage"]>;
  await act(async () => { handle = feed!.renderAssistantMessage({ id: "stream", content: "Copy" }, true); });
  expect(handle!).toBeTruthy();
  for (const locale of ["en", "zh-CN"]) {
    await act(async () => { setLocale(locale); });
    expect(container.querySelector(".message.user .message-content")?.textContent).toBe("Settings");
    expect(container.querySelector('[data-message-id="complete"] .message-content')?.textContent).toBe("Tools");
    expect(container.querySelector(".streaming-text")?.textContent).toBe("Copy");
  }
  await act(async () => { feed!.updateStreamingMessage(handle!, "Settings"); });
  await act(async () => { setLocale("zh-CN"); });
  expect(container.querySelector(".streaming-text")?.textContent).toBe("Settings");
  await act(async () => { feed!.finalizeStreamingMessage(handle!); });
  await act(async () => { setLocale("en"); setLocale("zh-CN"); });
  expect(container.querySelector('[data-message-id="stream"] .message-content')?.textContent).toBe("Settings");
});
