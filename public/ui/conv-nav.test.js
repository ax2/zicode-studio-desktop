import { describe, expect, it, vi } from "vitest";
import { ConvNav } from "../native/react/conv-nav.js";

function setupDom() {
  document.body.innerHTML = `
    <div class="header"></div>
    <div id="messages"></div>
    <div id="conv-nav" class="conv-nav">
      <div id="conv-nav-track"></div>
    </div>
    <div id="conv-nav-tooltip" class="hidden">
      <div id="conv-nav-tooltip-q"></div>
      <div id="conv-nav-tooltip-sep"></div>
      <div id="conv-nav-tooltip-a"></div>
    </div>
    <button type="button" id="scroll-bottom-badge" class="hidden">Latest ↓</button>
    <div id="conv-nav-live-status" role="status" aria-live="polite" aria-atomic="true"></div>
  `;

  const messages = document.getElementById("messages");
  Object.defineProperty(messages, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(messages, "scrollHeight", { configurable: true, value: 2000 });
  messages.scrollTop = 0;
  messages.scrollTo = vi.fn(({ top }) => {
    messages.scrollTop = top;
    messages.dispatchEvent(new Event("scroll"));
  });

  const header = document.querySelector(".header");
  header.getBoundingClientRect = () => ({ bottom: 100 });

  return { messages, header, badge: document.getElementById("scroll-bottom-badge") };
}

function appendTurn(messages, userTop, assistantTop) {
  const user = document.createElement("div");
  user.className = "message user";
  user.innerHTML = '<div class="message-content">User</div>';
  user.getBoundingClientRect = () => ({ top: userTop });

  const assistant = document.createElement("div");
  assistant.className = "message assistant";
  assistant.innerHTML = '<div class="message-content">Assistant</div>';
  assistant.getBoundingClientRect = () => ({ top: assistantTop });

  messages.append(user, assistant);
}

describe("ConvNav", () => {
  it("rewires dot clicks after messages are re-rendered with the same turn count", () => {
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });

    appendTurn(messages, 120, 180);
    appendTurn(messages, 220, 280);
    nav.mount();

    messages.replaceChildren();
    appendTurn(messages, 420, 480);
    appendTurn(messages, 620, 680);
    nav.rebuild();

    document.querySelectorAll(".conv-nav-dot")[1].click();

    expect(messages.scrollTop).toBe(520);
    nav.destroy();
  });

  it("reveals an actionable latest-message button and scrolls to the bottom", () => {
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });
    appendTurn(messages, 120, 180);
    appendTurn(messages, 220, 280);
    nav.mount();

    messages.scrollTop = 900;
    messages.dispatchEvent(new Event("scroll"));
    nav.notifyNewMessage();

    expect(badge.classList.contains("hidden")).toBe(false);
    expect(badge.tagName).toBe("BUTTON");
    expect(document.getElementById("conv-nav-live-status")?.textContent).toMatch(
      /new answer|新回答/i,
    );
    badge.click();
    expect(messages.scrollTo).toHaveBeenCalledWith({ top: 1600, behavior: "smooth" });
    expect(badge.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("conv-nav-live-status")?.textContent).toBe("");
    expect(document.activeElement).toBe(messages.lastElementChild);
    expect(messages.lastElementChild?.getAttribute("tabindex")).toBe("-1");

    const nextControl = document.createElement("button");
    document.body.appendChild(nextControl);
    nextControl.focus();
    expect(messages.lastElementChild?.hasAttribute("tabindex")).toBe(false);

    nav.destroy();
  });

  it("reveals the latest badge as soon as an answer starts streaming while scrolled up", () => {
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });
    nav.mount();

    messages.scrollTop = 1000;
    messages.dispatchEvent(new Event("scroll"));
    expect(badge.classList.contains("hidden")).toBe(true);

    nav.notifyStreamingStart();
    expect(badge.classList.contains("hidden")).toBe(false);
    expect(
      document.getElementById("conv-nav-live-status").textContent.length,
    ).toBeGreaterThan(0);
    nav.destroy();
  });

  it("keeps the badge hidden when streaming starts while at the bottom", () => {
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });
    nav.mount();

    messages.scrollTop = 1600;
    messages.dispatchEvent(new Event("scroll"));
    expect(badge.classList.contains("hidden")).toBe(true);

    nav.notifyStreamingStart();
    expect(badge.classList.contains("hidden")).toBe(true);
    nav.destroy();
  });

  it("does not steal focus when the user manually reaches the bottom", () => {
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });
    appendTurn(messages, 120, 180);
    appendTurn(messages, 220, 280);
    nav.mount();

    const currentControl = document.createElement("button");
    document.body.appendChild(currentControl);
    currentControl.focus();
    messages.scrollTop = 1600;
    messages.dispatchEvent(new Event("scroll"));

    expect(document.activeElement).toBe(currentControl);
    expect(messages.lastElementChild?.hasAttribute("tabindex")).toBe(false);
    nav.destroy();
  });

  it("uses instant scrolling when the user prefers reduced motion", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });
    appendTurn(messages, 120, 180);
    appendTurn(messages, 220, 280);
    nav.mount();

    messages.scrollTop = 900;
    messages.dispatchEvent(new Event("scroll"));
    nav.notifyNewMessage();
    badge.click();

    expect(messages.scrollTo).toHaveBeenCalledWith({ top: 1600, behavior: "instant" });
    messages.scrollTo.mockClear();
    document.querySelectorAll(".conv-nav-dot")[1].click();
    expect(messages.scrollTo).toHaveBeenCalledWith({ top: 1600, behavior: "instant" });
    nav.destroy();
    window.matchMedia = originalMatchMedia;
  });

  it("uses instant scrolling for a long jump to the latest message", () => {
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });
    appendTurn(messages, 120, 180);
    appendTurn(messages, 220, 280);
    nav.mount();

    messages.scrollTop = 300;
    messages.dispatchEvent(new Event("scroll"));
    nav.notifyNewMessage();
    badge.click();

    expect(messages.scrollTo).toHaveBeenCalledWith({ top: 1600, behavior: "instant" });
    expect(badge.classList.contains("hidden")).toBe(true);
    nav.destroy();
  });

  it("refreshes localized conversation labels after a locale change", () => {
    const { messages, header, badge } = setupDom();
    const nav = new ConvNav({ messagesEl: messages, headerEl: header, badgeEl: badge });
    appendTurn(messages, 120, 180);
    appendTurn(messages, 220, 280);
    nav.mount();

    window.dispatchEvent(new CustomEvent("zicode:locale-changed"));
    expect(document.querySelector(".conv-nav-dot")?.getAttribute("aria-label")).toMatch(
      /conversation|对话/i,
    );
    nav.destroy();
  });
});
