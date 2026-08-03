import { t } from "../i18n.js";

/**
 * Conversation navigator rail (Codex-style dot track).
 *
 * Renders a vertical rail of dots — one per user/assistant turn — to the
 * right of the chat messages. Clicking a dot jumps to that conversation.
 * Hovering shows a tooltip with the first ~120 chars of the user prompt and
 * ~180 chars of the assistant reply.
 *
 * Usage:
 *   const nav = new ConvNav({
 *     messagesEl,   // the scrollable #messages container
 *     headerEl,     // the floating .header element (for offset calc)
 *     badgeEl,      // #scroll-bottom-badge
 *   });
 *   nav.mount();   // wire scroll + mutation + resize listeners
 *   nav.rebuild(); // call explicitly after a full history render
 *   nav.notifyNewMessage(); // call when a new assistant message arrives
 *   nav.destroy(); // clean up listeners
 */
export class ConvNav {
  #messagesEl;
  #headerEl;
  #badgeEl;
  #navEl;
  #trackEl;
  #tooltipEl;
  #tooltipQ;
  #tooltipA;
  #tooltipSep;
  #statusEl;

  #isScrolledUp = false;
  #tooltipHideTimer = null;
  #navLockedIdx = -1;
  #navLockTimer = null;
  #pendingLatestFocus = false;
  #latestFocusTimer = null;

  static #MAX_HEIGHT = 560;

  constructor({ messagesEl, headerEl, badgeEl }) {
    this.#messagesEl = messagesEl;
    this.#headerEl = headerEl;
    this.#badgeEl = badgeEl;
    this.#navEl = document.getElementById("conv-nav");
    this.#trackEl = document.getElementById("conv-nav-track");
    this.#tooltipEl = document.getElementById("conv-nav-tooltip");
    this.#tooltipQ = document.getElementById("conv-nav-tooltip-q");
    this.#tooltipA = document.getElementById("conv-nav-tooltip-a");
    this.#tooltipSep = document.getElementById("conv-nav-tooltip-sep");
    this.#statusEl = document.getElementById("conv-nav-live-status");
  }

  mount() {
    if (!this.#navEl || !this.#trackEl || !this.#messagesEl) return;

    if (this.#tooltipEl) {
      this.#tooltipEl.onmouseenter = () => clearTimeout(this.#tooltipHideTimer);
      this.#tooltipEl.onmouseleave = () => this.#hideTooltip();
    }

    this._onScroll = () => {
      const threshold = 150;
      const el = this.#messagesEl;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      this.#isScrolledUp = !atBottom;
      if (atBottom) {
        this.#badgeEl?.classList.add("hidden");
        this.#clearLatestAnnouncement();
        this.#focusLatestMessage();
      }
      this.#buildDots();
    };

    this._onResize = () => this.#buildDots();
    this._onLocaleChange = () => {
      this.#refreshLocalizedLabels();
      this.#buildDots();
    };
    this._onBadgeClick = () => this.#scrollToLatest();

    this._observer = new MutationObserver(() => this.#buildDots());
    this._observer.observe(this.#messagesEl, { childList: true });

    this.#messagesEl.addEventListener("scroll", this._onScroll);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("zicode:locale-changed", this._onLocaleChange);
    this.#badgeEl?.addEventListener("click", this._onBadgeClick);

    this.#refreshLocalizedLabels();
    this.#buildDots();
  }

  destroy() {
    this.#messagesEl?.removeEventListener("scroll", this._onScroll);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("zicode:locale-changed", this._onLocaleChange);
    this.#badgeEl?.removeEventListener("click", this._onBadgeClick);
    this._observer?.disconnect();
    clearTimeout(this.#latestFocusTimer);
    this.#pendingLatestFocus = false;
    this.#clearLatestAnnouncement();
  }

  /**
   * Call explicitly after renderHistory() finishes so the nav is always
   * up-to-date even if MutationObserver batching skipped a frame.
   */
  rebuild() {
    this.#buildDots();
  }

  /** Call after a new assistant message finishes rendering. */
  notifyNewMessage() {
    if (this.#isScrolledUp) {
      this.#badgeEl?.classList.remove("hidden");
      this.#announceLatest();
    }
    this.#buildDots();
  }

  /** Call when an assistant answer starts streaming, so scrolled-up users
   *  get an immediate activity hint instead of waiting for message_end. */
  notifyStreamingStart() {
    if (this.#isScrolledUp) {
      this.#badgeEl?.classList.remove("hidden");
      this.#announceLatest();
    }
    this.#buildDots();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Collect all (user, assistant?) turn pairs from the messages container. */
  #getConversations() {
    const turns = [];
    for (const node of this.#messagesEl.children) {
      if (node.classList.contains("message") && node.classList.contains("user")) {
        // Find the very next sibling that is an assistant message
        let sibling = node.nextElementSibling;
        while (sibling && !sibling.classList.contains("message")) {
          sibling = sibling.nextElementSibling;
        }
        const reply = sibling?.classList.contains("assistant") ? sibling : null;
        turns.push({ user: node, assistant: reply });
      }
    }
    return turns;
  }

  #refreshLocalizedLabels() {
    if (this.#badgeEl) {
      this.#badgeEl.textContent = t("Latest ↓");
      this.#badgeEl.setAttribute("aria-label", t("Jump to latest message"));
    }
    if (this.#statusEl?.textContent) this.#announceLatest();
  }

  #announceLatest() {
    if (!this.#statusEl) return;
    this.#statusEl.textContent = t(
      "A new answer is available. Use Latest to jump to the end.",
    );
  }

  #clearLatestAnnouncement() {
    if (this.#statusEl) this.#statusEl.textContent = "";
  }

  #requestLatestFocus() {
    this.#pendingLatestFocus = true;
    clearTimeout(this.#latestFocusTimer);
    this.#latestFocusTimer = setTimeout(() => {
      this.#pendingLatestFocus = false;
    }, 2000);
  }

  #focusLatestMessage() {
    if (!this.#pendingLatestFocus) return;
    clearTimeout(this.#latestFocusTimer);
    this.#pendingLatestFocus = false;

    const target = [...this.#messagesEl.children]
      .reverse()
      .find((element) => element.classList.contains("message"));
    if (!(target instanceof HTMLElement)) return;

    const hadTabIndex = target.hasAttribute("tabindex");
    if (!hadTabIndex) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    if (!hadTabIndex) {
      target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    }
  }

  #scrollBehavior(targetTop) {
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const isLongJump = Math.abs(targetTop - this.#messagesEl.scrollTop) > this.#messagesEl.clientHeight * 2;
    return prefersReducedMotion || isLongJump ? "instant" : "smooth";
  }

  #getActiveIndex(turns) {
    if (this.#navLockedIdx >= 0 && this.#navLockedIdx < turns.length) return this.#navLockedIdx;
    const visibleTop = Math.max(
      this.#messagesEl.getBoundingClientRect().top,
      this.#headerEl?.getBoundingClientRect().bottom || 0,
    );
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].user.getBoundingClientRect().top <= visibleTop + 4) return i;
    }
    return 0;
  }

  #buildDots() {
    const turns = this.#getConversations();
    const hasConvs = turns.length > 1;
    this.#navEl.classList.toggle("hidden", !hasConvs);
    if (!hasConvs) {
      this.#trackEl.replaceChildren();
      return;
    }

    const activeIdx = this.#getActiveIndex(turns);

    // Add missing dots
    while (this.#trackEl.children.length < turns.length) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "conv-nav-dot";
      dot.setAttribute(
        "aria-label",
        `${t("Jump to conversation")} ${this.#trackEl.children.length + 1}`,
      );
      this.#trackEl.appendChild(dot);
    }
    // Remove extra dots
    while (this.#trackEl.children.length > turns.length) {
      this.#trackEl.removeChild(this.#trackEl.lastChild);
    }

    [...this.#trackEl.children].forEach((dot, i) => {
      dot.onclick = () => this.#jumpTo(turns[i], i);
      dot.onmouseenter = () => {
        this.#applyWave(i);
        this.#showTooltip(dot, turns[i]);
      };
      dot.onmouseleave = () => {
        this.#clearWave();
        this.#hideTooltip();
      };
      dot.classList.toggle("active", i === activeIdx);
      dot.setAttribute("aria-label", `${t("Jump to conversation")} ${i + 1}`);
      // No wave when not hovering — keep all dots at their base CSS width
      dot.style.removeProperty("--nav-w");
    });

    // Scale down track if it exceeds the max nav height
    const naturalHeight = this.#trackEl.scrollHeight;
    const scale = naturalHeight > ConvNav.#MAX_HEIGHT ? ConvNav.#MAX_HEIGHT / naturalHeight : 1;
    this.#trackEl.style.transform = scale < 1 ? `scale(${scale})` : "";
    this.#trackEl.style.transformOrigin = scale < 1 ? "top right" : "";
    this.#navEl.style.height = scale < 1 ? `${naturalHeight * scale}px` : "";
  }

  /** Apply gaussian-bell width wave centered on the hovered dot index. */
  #applyWave(centerIdx) {
    [...this.#trackEl.children].forEach((dot, i) => {
      const dist = Math.abs(i - centerIdx);
      // Gaussian bell: peak 20 px, base 10 px, σ=3
      const w = Math.round(10 + 10 * Math.exp(-(dist * dist) / (2 * 3 * 3)));
      dot.style.setProperty("--nav-w", `${w}px`);
    });
  }

  /** Remove per-dot wave widths, letting CSS default take over. */
  #clearWave() {
    for (const dot of this.#trackEl.children) dot.style.removeProperty("--nav-w");
  }

  #jumpTo(turn, idx) {
    if (idx !== undefined) {
      this.#navLockedIdx = idx;
      clearTimeout(this.#navLockTimer);
      this.#navLockTimer = setTimeout(() => {
        this.#navLockedIdx = -1;
        this.#buildDots();
      }, 800);
    }
    const visibleTop =
      this.#headerEl?.getBoundingClientRect().bottom ||
      this.#messagesEl.getBoundingClientRect().top;
    const delta = turn.user.getBoundingClientRect().top - visibleTop;
    const maxScrollTop = this.#messagesEl.scrollHeight - this.#messagesEl.clientHeight;
    const targetScrollTop = Math.max(0, Math.min(this.#messagesEl.scrollTop + delta, maxScrollTop));
    this.#messagesEl.scrollTo({ top: targetScrollTop, behavior: this.#scrollBehavior(targetScrollTop) });
    this.#flashHighlight(turn.user);
    this.#buildDots();
  }

  #scrollToLatest() {
    const top = Math.max(0, this.#messagesEl.scrollHeight - this.#messagesEl.clientHeight);
    const behavior = this.#scrollBehavior(top);
    this.#requestLatestFocus();
    if (typeof this.#messagesEl.scrollTo === "function") {
      this.#messagesEl.scrollTo({ top, behavior });
    } else {
      this.#messagesEl.scrollTop = top;
    }
    if (behavior === "instant" || typeof this.#messagesEl.scrollTo !== "function") {
      this.#isScrolledUp = false;
      this.#badgeEl?.classList.add("hidden");
      this.#clearLatestAnnouncement();
      this.#focusLatestMessage();
    }
    this.#buildDots();
  }

  #flashHighlight(target) {
    target.classList.remove("message-jump-highlight");
    void target.offsetWidth; // reflow to replay animation
    target.classList.add("message-jump-highlight");
    target.addEventListener(
      "animationend",
      () => target.classList.remove("message-jump-highlight"),
      {
        once: true,
      },
    );
  }

  #showTooltip(dotEl, turn) {
    if (!this.#tooltipEl) return;
    clearTimeout(this.#tooltipHideTimer);
    const q = turn.user.textContent.trim().slice(0, 120);
    const a = turn.assistant
      ? turn.assistant.textContent.trim().replace(/\s+/g, " ").slice(0, 180)
      : "";
    if (this.#tooltipQ) this.#tooltipQ.textContent = q;
    if (this.#tooltipA) {
      this.#tooltipA.textContent = a;
      this.#tooltipA.style.display = a ? "" : "none";
    }
    if (this.#tooltipSep) this.#tooltipSep.style.display = a ? "" : "none";

    this.#tooltipEl.classList.remove("hidden");
    const dotRect = dotEl.getBoundingClientRect();
    const tipHeight = this.#tooltipEl.offsetHeight || 90;
    const top = Math.max(
      8,
      Math.min(
        dotRect.top + dotRect.height / 2 - tipHeight / 2,
        window.innerHeight - tipHeight - 8,
      ),
    );
    this.#tooltipEl.style.top = `${top}px`;

    this.#tooltipEl.classList.remove("animating");
    void this.#tooltipEl.offsetWidth; // reflow
    this.#tooltipEl.classList.add("animating");
    this.#tooltipEl.addEventListener(
      "animationend",
      () => this.#tooltipEl?.classList.remove("animating"),
      { once: true },
    );
  }

  #hideTooltip() {
    if (!this.#tooltipEl) return;
    this.#tooltipHideTimer = setTimeout(() => this.#tooltipEl.classList.add("hidden"), 120);
  }
}
