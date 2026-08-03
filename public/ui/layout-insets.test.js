import { afterEach, describe, expect, test, vi } from "vitest";
import { setupMessagesInsets, syncMessagesInsets } from "./layout-insets.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete window.visualViewport;
  document.body.className = "";
  document.body.replaceChildren();
});

describe("syncMessagesInsets", () => {
  test("uses the live header and composer heights instead of hard-coded message padding", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");

    syncMessagesInsets({
      main,
      messages,
      header,
      inputArea,
      measureHeight: (element) => {
        if (element === header) return 92;
        if (element === inputArea) return 118;
        return 0;
      },
    });

    expect(main.style.getPropertyValue("--messages-top-inset")).toBe("104px");
    expect(main.style.getPropertyValue("--messages-bottom-inset")).toBe("130px");
    expect(messages.style.getPropertyValue("scroll-padding-top")).toBe("104px");
    expect(messages.style.getPropertyValue("scroll-padding-bottom")).toBe("130px");
  });

  test("never shrinks below the base safe insets", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");

    syncMessagesInsets({
      main,
      messages,
      header,
      inputArea,
      measureHeight: () => 20,
    });

    expect(main.style.getPropertyValue("--messages-top-inset")).toBe("52px");
    expect(main.style.getPropertyValue("--messages-bottom-inset")).toBe("128px");
  });

  test("keeps messages above mobile navigation as well as the composer", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");
    main.style.setProperty("--mobile-navigation-inset", "56px");

    syncMessagesInsets({
      main,
      messages,
      header,
      inputArea,
      measureHeight: (element) => (element === inputArea ? 118 : 48),
    });

    expect(main.style.getPropertyValue("--messages-bottom-inset")).toBe("186px");
    expect(messages.style.getPropertyValue("scroll-padding-bottom")).toBe("186px");
  });

  test("does not mistake initial composer focus for an open software keyboard", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");
    const input = document.createElement("textarea");
    inputArea.append(input);
    document.body.append(main, messages, header, inputArea);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844,
    });
    const frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    const destroy = setupMessagesInsets({ main, messages, header, inputArea });
    frames.shift()();
    input.focus();
    inputArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    frames.shift()();

    expect(document.body.classList.contains("mobile-keyboard-open")).toBe(false);

    window.innerHeight = 620;
    window.dispatchEvent(new Event("resize"));
    frames.shift()();
    expect(document.body.classList.contains("mobile-keyboard-open")).toBe(true);
    destroy();
  });

  test("tracks the iOS visual viewport while the software keyboard pans the page", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");
    const input = document.createElement("textarea");
    inputArea.append(input);
    document.body.append(main, messages, header, inputArea);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844,
    });
    const visualViewport = new EventTarget();
    Object.assign(visualViewport, { height: 844, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    const frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    const destroy = setupMessagesInsets({ main, messages, header, inputArea });
    frames.shift()();
    input.focus();
    inputArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    frames.shift()();

    visualViewport.height = 520;
    visualViewport.offsetTop = 72;
    visualViewport.dispatchEvent(new Event("resize"));
    frames.shift()();

    expect(document.body.classList.contains("mobile-keyboard-open")).toBe(true);
    expect(
      document.documentElement.style.getPropertyValue("--mobile-visual-viewport-top"),
    ).toBe("72px");
    expect(
      document.documentElement.style.getPropertyValue("--mobile-visual-viewport-bottom"),
    ).toBe("252px");
    expect(main.style.getPropertyValue("--mobile-visual-viewport-top")).toBe("72px");
    expect(main.style.getPropertyValue("--mobile-visual-viewport-bottom")).toBe("252px");
    expect(main.style.getPropertyValue("--messages-top-inset")).toBe("124px");
    expect(main.style.getPropertyValue("--messages-bottom-inset")).toBe("264px");

    visualViewport.offsetTop = 112;
    visualViewport.dispatchEvent(new Event("scroll"));
    frames.shift()();
    expect(main.style.getPropertyValue("--mobile-visual-viewport-top")).toBe("112px");
    expect(main.style.getPropertyValue("--mobile-visual-viewport-bottom")).toBe("212px");

    input.blur();
    inputArea.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    frames.shift()();
    expect(document.body.classList.contains("mobile-keyboard-open")).toBe(false);
    expect(main.style.getPropertyValue("--mobile-visual-viewport-top")).toBe("0px");
    expect(main.style.getPropertyValue("--mobile-visual-viewport-bottom")).toBe("0px");

    destroy();
    expect(
      document.documentElement.style.getPropertyValue("--mobile-visual-viewport-top"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--mobile-visual-viewport-bottom"),
    ).toBe("");
    expect(main.style.getPropertyValue("--mobile-visual-viewport-top")).toBe("");
    expect(main.style.getPropertyValue("--mobile-visual-viewport-bottom")).toBe("");
  });

  test("keeps a long conversation pinned when viewport insets grow near the bottom", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");
    const input = document.createElement("textarea");
    inputArea.append(input);
    document.body.append(main, messages, header, inputArea);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844,
    });
    const visualViewport = new EventTarget();
    Object.assign(visualViewport, { height: 844, offsetTop: 0 });
    let viewportInsetsApplied = false;
    Object.defineProperty(messages, "scrollHeight", {
      configurable: true,
      get: () => (viewportInsetsApplied ? 1336 : 1200),
    });
    Object.defineProperty(messages, "clientHeight", { configurable: true, value: 500 });
    messages.scrollTop = 660;
    messages.scrollTo = vi.fn(({ top }) => {
      messages.scrollTop = top;
    });
    const frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    const destroy = setupMessagesInsets({
      main,
      messages,
      header,
      inputArea,
      visualViewport,
    });
    frames.shift()();
    expect(messages.scrollTop).toBe(700);

    input.focus();
    inputArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    frames.shift()();
    visualViewport.height = 520;
    visualViewport.offsetTop = 72;
    visualViewport.dispatchEvent(new Event("resize"));
    viewportInsetsApplied = true;
    messages.dispatchEvent(new Event("scroll"));
    frames.shift()();

    expect(messages.scrollTop).toBe(836);
    expect(messages.scrollTo).toHaveBeenLastCalledWith({ top: 836, behavior: "instant" });
    destroy();
  });

  test("preserves history reading position when viewport insets change away from the bottom", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");
    const input = document.createElement("textarea");
    inputArea.append(input);
    document.body.append(main, messages, header, inputArea);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844,
    });
    const visualViewport = new EventTarget();
    Object.assign(visualViewport, { height: 844, offsetTop: 0 });
    Object.defineProperty(messages, "scrollHeight", {
      configurable: true,
      get: () =>
        main.style.getPropertyValue("--mobile-visual-viewport-bottom") === "252px" ? 1336 : 1200,
    });
    Object.defineProperty(messages, "clientHeight", { configurable: true, value: 500 });
    messages.scrollTop = 700;
    messages.scrollTo = vi.fn(({ top }) => {
      messages.scrollTop = top;
    });
    const frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    const destroy = setupMessagesInsets({
      main,
      messages,
      header,
      inputArea,
      visualViewport,
    });
    frames.shift()();
    messages.scrollTop = 240;
    messages.dispatchEvent(new Event("scroll"));
    input.focus();
    inputArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    frames.shift()();
    visualViewport.height = 520;
    visualViewport.offsetTop = 72;
    visualViewport.dispatchEvent(new Event("resize"));
    frames.shift()();

    expect(messages.scrollTop).toBe(240);
    destroy();
  });
});
