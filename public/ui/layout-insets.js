const BASE_TOP_INSET = 52;
const BASE_BOTTOM_INSET = 128;
const CHROME_GAP = 12;
const BOTTOM_ANCHOR_THRESHOLD = 100;

function defaultMeasureHeight(element) {
  if (!element) return 0;
  const rect = element.getBoundingClientRect?.();
  return Math.ceil(rect?.height || element.offsetHeight || 0);
}

function readCssInset(element, property) {
  if (!element || typeof getComputedStyle !== "function") return 0;
  return Number.parseFloat(getComputedStyle(element).getPropertyValue(property)) || 0;
}

export function syncMessagesInsets({
  main,
  messages,
  header,
  inputArea,
  measureHeight = defaultMeasureHeight,
} = {}) {
  if (!main || !messages || !header || !inputArea) {
    return {
      topInset: BASE_TOP_INSET,
      bottomInset: BASE_BOTTOM_INSET,
    };
  }

  const topInset = Math.max(BASE_TOP_INSET, measureHeight(header) + CHROME_GAP);
  const navigationInset = readCssInset(main, "--mobile-navigation-inset");
  const viewportTopInset = readCssInset(main, "--mobile-visual-viewport-top");
  const viewportBottomInset = readCssInset(main, "--mobile-visual-viewport-bottom");
  const safeTopInset = topInset + viewportTopInset;
  const bottomInset = Math.max(
    BASE_BOTTOM_INSET,
    measureHeight(inputArea) + CHROME_GAP + navigationInset + viewportBottomInset,
  );

  main.style.setProperty("--messages-top-inset", `${safeTopInset}px`);
  main.style.setProperty("--messages-bottom-inset", `${bottomInset}px`);
  messages.style.setProperty("scroll-padding-top", `${safeTopInset}px`);
  messages.style.setProperty("scroll-padding-bottom", `${bottomInset}px`);

  return { topInset: safeTopInset, bottomInset };
}

export function setupMessagesInsets({
  main,
  messages,
  header,
  inputArea,
  visualViewport = window.visualViewport,
} = {}) {
  let frameId = 0;
  let alignmentFrameId = 0;
  let baselineViewportHeight = viewportHeight(visualViewport);
  let bottomAnchorIntent = isNearBottom(messages);
  let pendingBottomAnchorIntent = bottomAnchorIntent;

  const trackBottomAnchorIntent = () => {
    bottomAnchorIntent = isNearBottom(messages);
  };

  const syncKeyboardState = () => {
    const currentHeight = viewportHeight(visualViewport);
    const composerFocused = Boolean(inputArea?.contains?.(document.activeElement));
    if (!composerFocused) baselineViewportHeight = currentHeight;
    const keyboardOpen = composerFocused && baselineViewportHeight - currentHeight >= 100;
    const viewportInsets = keyboardOpen
      ? visualViewportInsets(visualViewport)
      : { top: 0, bottom: 0 };
    document.body.classList.toggle("mobile-keyboard-open", keyboardOpen);
    document.documentElement.style.setProperty(
      "--mobile-visual-viewport-top",
      `${viewportInsets.top}px`,
    );
    document.documentElement.style.setProperty(
      "--mobile-visual-viewport-bottom",
      `${viewportInsets.bottom}px`,
    );
    main?.style.setProperty("--mobile-visual-viewport-top", `${viewportInsets.top}px`);
    main?.style.setProperty("--mobile-visual-viewport-bottom", `${viewportInsets.bottom}px`);
  };

  const sync = () => {
    frameId = 0;
    syncKeyboardState();
    syncMessagesInsets({ main, messages, header, inputArea });
    syncMessagesAlignment(messages);
    if (pendingBottomAnchorIntent) scrollToBottom(messages);
    bottomAnchorIntent = pendingBottomAnchorIntent || isNearBottom(messages);
  };

  const scheduleSync = () => {
    if (frameId) return;
    pendingBottomAnchorIntent = bottomAnchorIntent;
    frameId = requestAnimationFrame(sync);
  };

  const handleComposerFocus = () => {
    bottomAnchorIntent = isNearBottom(messages);
    scheduleSync();
  };

  scheduleSync();

  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          scheduleSync();
        })
      : null;

  observer?.observe(header);
  observer?.observe(inputArea);
  observer?.observe(main);

  // Message content grows during streaming/history renders without resizing
  // the scroller itself, so watch the DOM and re-evaluate the alignment class
  // on the next frame (bounded to one pass per frame).
  const scheduleAlignmentSync = () => {
    if (alignmentFrameId) return;
    alignmentFrameId = requestAnimationFrame(() => {
      alignmentFrameId = 0;
      syncMessagesAlignment(messages);
    });
  };
  const alignmentObserver =
    typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
          // The alignment class toggle on the scroller itself is managed here;
          // only react to content changes (children/text) so the toggle never
          // reschedules itself.
          const contentChanged = records.some(
            (record) => !(record.type === "attributes" && record.target === messages),
          );
          if (contentChanged) scheduleAlignmentSync();
        })
      : null;
  alignmentObserver?.observe(messages, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  window.addEventListener("resize", scheduleSync);
  visualViewport?.addEventListener("resize", scheduleSync);
  visualViewport?.addEventListener("scroll", scheduleSync);
  inputArea?.addEventListener("focusin", handleComposerFocus);
  inputArea?.addEventListener("focusout", scheduleSync);
  messages?.addEventListener("scroll", trackBottomAnchorIntent);

  return () => {
    if (frameId) cancelAnimationFrame(frameId);
    if (alignmentFrameId) cancelAnimationFrame(alignmentFrameId);
    observer?.disconnect();
    alignmentObserver?.disconnect();
    window.removeEventListener("resize", scheduleSync);
    visualViewport?.removeEventListener("resize", scheduleSync);
    visualViewport?.removeEventListener("scroll", scheduleSync);
    inputArea?.removeEventListener("focusin", handleComposerFocus);
    inputArea?.removeEventListener("focusout", scheduleSync);
    messages?.removeEventListener("scroll", trackBottomAnchorIntent);
    document.body.classList.remove("mobile-keyboard-open");
    document.documentElement.style.removeProperty("--mobile-visual-viewport-top");
    document.documentElement.style.removeProperty("--mobile-visual-viewport-bottom");
    main?.style.removeProperty("--mobile-visual-viewport-top");
    main?.style.removeProperty("--mobile-visual-viewport-bottom");
  };
}

export function syncMessagesAlignment(messages) {
  if (!messages) return;
  // Chromium under-reports scrollHeight while flex-end is active because the
  // overflow above the scroller is not part of the scroll area. Normalize to
  // top-flow before measuring so long histories are never misjudged as short.
  const wasAligned = messages.classList.contains("messages-bottom-aligned");
  if (wasAligned) {
    messages.classList.remove("messages-bottom-aligned");
    // Force a synchronous reflow so scrollHeight reflects the real content.
    void messages.getBoundingClientRect();
  }
  const fits = messages.scrollHeight <= messages.clientHeight + 1;
  messages.classList.toggle("messages-bottom-aligned", fits);
}

function viewportHeight(visualViewport = window.visualViewport) {
  return Math.round(visualViewport?.height || window.innerHeight || 0);
}

function visualViewportInsets(viewport = window.visualViewport) {
  if (!viewport) return { top: 0, bottom: 0 };

  const layoutHeight = Math.max(0, Math.round(window.innerHeight || viewport.height || 0));
  const height = Math.max(0, Math.round(viewport.height || layoutHeight));
  const top = Math.max(0, Math.round(viewport.offsetTop || 0));
  const bottom = Math.max(0, layoutHeight - height - top);
  return { top, bottom };
}

function isNearBottom(element) {
  if (!element) return false;
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance < BOTTOM_ANCHOR_THRESHOLD;
}

function scrollToBottom(element) {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ top: maxScrollTop, behavior: "instant" });
  } else {
    element.scrollTop = maxScrollTop;
  }
}
