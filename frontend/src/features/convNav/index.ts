import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { t } from "../../shared/i18n";
import { ConvNavTooltip, ConvNavTrack } from "./ConvNavApp";
import {
  MAX_NAV_HEIGHT,
  scrollBehavior,
  tooltipAssistantPreview,
  tooltipUserPreview,
} from "./convNavLogic";

interface ConversationTurn {
  user: HTMLElement;
  assistant: HTMLElement | null;
}

export interface ConvNavOptions {
  messagesEl: HTMLElement | null;
  headerEl: HTMLElement | null;
  badgeEl: HTMLElement | null;
}

export class ConvNav {
  #messagesEl: HTMLElement | null;
  #headerEl: HTMLElement | null;
  #badgeEl: HTMLElement | null;
  #navEl: HTMLElement | null;
  #trackEl: HTMLElement | null;
  #tooltipEl: HTMLElement | null;
  #statusEl: HTMLElement | null;
  #trackRoot: Root | null = null;
  #tooltipRoot: Root | null = null;

  #turns: ConversationTurn[] = [];
  #activeIdx = 0;
  #hoveredIdx = -1;
  #isScrolledUp = false;
  #tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;
  #navLockedIdx = -1;
  #navLockTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingLatestFocus = false;
  #latestFocusTimer: ReturnType<typeof setTimeout> | null = null;
  #observer: MutationObserver | null = null;
  #onScroll: () => void = () => {};
  #onResize: () => void = () => {};
  #onLocaleChange: () => void = () => {};
  #onBadgeClick: () => void = () => {};

  constructor({ messagesEl, headerEl, badgeEl }: ConvNavOptions) {
    this.#messagesEl = messagesEl;
    this.#headerEl = headerEl;
    this.#badgeEl = badgeEl;
    this.#navEl = document.getElementById("conv-nav");
    this.#trackEl = document.getElementById("conv-nav-track");
    this.#tooltipEl = document.getElementById("conv-nav-tooltip");
    this.#statusEl = document.getElementById("conv-nav-live-status");
    if (this.#trackEl) this.#trackRoot = createRoot(this.#trackEl);
    if (this.#tooltipEl) this.#tooltipRoot = createRoot(this.#tooltipEl);
  }

  mount() {
    if (!this.#navEl || !this.#trackEl || !this.#messagesEl) return;

    if (this.#tooltipEl) {
      this.#tooltipEl.onmouseenter = () => {
        if (this.#tooltipHideTimer) clearTimeout(this.#tooltipHideTimer);
      };
      this.#tooltipEl.onmouseleave = () => this.#hideTooltip();
    }

    this.#onScroll = () => {
      const threshold = 150;
      const el = this.#messagesEl;
      if (!el) return;
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      this.#isScrolledUp = !atBottom;
      if (atBottom) {
        this.#badgeEl?.classList.add("hidden");
        this.#clearLatestAnnouncement();
        this.#focusLatestMessage();
      }
      this.#buildDots();
    };

    this.#onResize = () => this.#buildDots();
    this.#onLocaleChange = () => {
      this.#refreshLocalizedLabels();
      this.#buildDots();
    };
    this.#onBadgeClick = () => this.#scrollToLatest();

    this.#observer = new MutationObserver(() => this.#buildDots());
    this.#observer.observe(this.#messagesEl, { childList: true });

    this.#messagesEl.addEventListener("scroll", this.#onScroll);
    window.addEventListener("resize", this.#onResize);
    window.addEventListener("zicode:locale-changed", this.#onLocaleChange);
    this.#badgeEl?.addEventListener("click", this.#onBadgeClick);

    this.#refreshLocalizedLabels();
    this.#buildDots();
  }

  destroy() {
    this.#messagesEl?.removeEventListener("scroll", this.#onScroll);
    window.removeEventListener("resize", this.#onResize);
    window.removeEventListener("zicode:locale-changed", this.#onLocaleChange);
    this.#badgeEl?.removeEventListener("click", this.#onBadgeClick);
    this.#observer?.disconnect();
    if (this.#latestFocusTimer) clearTimeout(this.#latestFocusTimer);
    this.#pendingLatestFocus = false;
    this.#clearLatestAnnouncement();
    this.#trackRoot?.unmount();
    this.#tooltipRoot?.unmount();
  }

  rebuild() {
    this.#buildDots();
  }

  notifyNewMessage() {
    if (this.#isScrolledUp) {
      this.#badgeEl?.classList.remove("hidden");
      this.#announceLatest();
    }
    this.#buildDots();
  }

  notifyStreamingStart() {
    if (this.#isScrolledUp) {
      this.#badgeEl?.classList.remove("hidden");
      this.#announceLatest();
    }
    this.#buildDots();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  #getConversations(): ConversationTurn[] {
    const turns: ConversationTurn[] = [];
    if (!this.#messagesEl) return turns;
    for (const node of this.#messagesEl.children) {
      if (node.classList.contains("message") && node.classList.contains("user")) {
        let sibling = node.nextElementSibling;
        while (sibling && !sibling.classList.contains("message")) {
          sibling = sibling.nextElementSibling;
        }
        const reply = sibling?.classList.contains("assistant") ? sibling : null;
        turns.push({
          user: node as HTMLElement,
          assistant: reply as HTMLElement | null,
        });
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
    if (this.#latestFocusTimer) clearTimeout(this.#latestFocusTimer);
    this.#latestFocusTimer = setTimeout(() => {
      this.#pendingLatestFocus = false;
    }, 2000);
  }

  #focusLatestMessage() {
    if (!this.#pendingLatestFocus || !this.#messagesEl) return;
    if (this.#latestFocusTimer) clearTimeout(this.#latestFocusTimer);
    this.#pendingLatestFocus = false;

    const target = [...this.#messagesEl.children]
      .reverse()
      .find((element) => element.classList.contains("message"));
    if (!(target instanceof HTMLElement)) return;

    const hadTabIndex = target.hasAttribute("tabindex");
    if (!hadTabIndex) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    if (!hadTabIndex) {
      target.addEventListener(
        "blur",
        () => target.removeAttribute("tabindex"),
        { once: true },
      );
    }
  }

  #jumpBehavior(targetTop: number): "instant" | "smooth" {
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const isLongJump =
      Math.abs(targetTop - (this.#messagesEl?.scrollTop ?? 0)) >
      (this.#messagesEl?.clientHeight ?? 0) * 2;
    return scrollBehavior(prefersReducedMotion, isLongJump);
  }

  #getActiveIndex(turns: ConversationTurn[]): number {
    if (this.#navLockedIdx >= 0 && this.#navLockedIdx < turns.length) {
      return this.#navLockedIdx;
    }
    const visibleTop = Math.max(
      this.#messagesEl?.getBoundingClientRect().top ?? 0,
      this.#headerEl?.getBoundingClientRect().bottom || 0,
    );
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (turns[index].user.getBoundingClientRect().top <= visibleTop + 4) {
        return index;
      }
    }
    return 0;
  }

  #renderDots() {
    const root = this.#trackRoot;
    if (!root) return;
    flushSync(() => {
      root.render(
        createElement(ConvNavTrack, {
          turnCount: this.#turns.length,
          activeIdx: this.#activeIdx,
          hoveredIdx: this.#hoveredIdx,
          onDotClick: (index: number) => {
            const turn = this.#turns[index];
            if (turn) this.#jumpTo(turn, index);
          },
          onDotEnter: (index: number) => {
            this.#applyWave(index);
            this.#showTooltip(index);
          },
          onDotLeave: () => {
            this.#clearWave();
            this.#hideTooltip();
          },
        }),
      );
    });
  }

  #buildDots() {
    const turns = this.#getConversations();
    const hasConvs = turns.length > 1;
    this.#navEl?.classList.toggle("hidden", !hasConvs);
    if (!hasConvs) {
      this.#turns = [];
      this.#renderDots();
      return;
    }

    this.#turns = turns;
    this.#activeIdx = this.#getActiveIndex(turns);
    this.#renderDots();

    const track = this.#trackEl;
    if (!track) return;
    const naturalHeight = track.scrollHeight;
    const scale =
      naturalHeight > MAX_NAV_HEIGHT ? MAX_NAV_HEIGHT / naturalHeight : 1;
    track.style.transform = scale < 1 ? `scale(${scale})` : "";
    track.style.transformOrigin = scale < 1 ? "top right" : "";
    if (this.#navEl) {
      this.#navEl.style.height =
        scale < 1 ? `${naturalHeight * scale}px` : "";
    }
  }

  #applyWave(centerIdx: number) {
    this.#hoveredIdx = centerIdx;
    this.#renderDots();
  }

  #clearWave() {
    this.#hoveredIdx = -1;
    this.#renderDots();
  }

  #jumpTo(turn: ConversationTurn, index: number) {
    if (index !== undefined) {
      this.#navLockedIdx = index;
      if (this.#navLockTimer) clearTimeout(this.#navLockTimer);
      this.#navLockTimer = setTimeout(() => {
        this.#navLockedIdx = -1;
        this.#buildDots();
      }, 800);
    }
    const visibleTop =
      this.#headerEl?.getBoundingClientRect().bottom ||
      this.#messagesEl?.getBoundingClientRect().top ||
      0;
    const delta = turn.user.getBoundingClientRect().top - visibleTop;
    const maxScrollTop =
      (this.#messagesEl?.scrollHeight ?? 0) -
      (this.#messagesEl?.clientHeight ?? 0);
    const targetScrollTop = Math.max(
      0,
      Math.min((this.#messagesEl?.scrollTop ?? 0) + delta, maxScrollTop),
    );
    this.#messagesEl?.scrollTo({
      top: targetScrollTop,
      behavior: this.#jumpBehavior(targetScrollTop),
    });
    this.#flashHighlight(turn.user);
    this.#buildDots();
  }

  #scrollToLatest() {
    const top = Math.max(
      0,
      (this.#messagesEl?.scrollHeight ?? 0) -
        (this.#messagesEl?.clientHeight ?? 0),
    );
    const behavior = this.#jumpBehavior(top);
    this.#requestLatestFocus();
    if (typeof this.#messagesEl?.scrollTo === "function") {
      this.#messagesEl.scrollTo({ top, behavior });
    } else if (this.#messagesEl) {
      this.#messagesEl.scrollTop = top;
    }
    if (
      behavior === "instant" ||
      typeof this.#messagesEl?.scrollTo !== "function"
    ) {
      this.#isScrolledUp = false;
      this.#badgeEl?.classList.add("hidden");
      this.#clearLatestAnnouncement();
      this.#focusLatestMessage();
    }
    this.#buildDots();
  }

  #flashHighlight(target: HTMLElement) {
    target.classList.remove("message-jump-highlight");
    void target.offsetWidth;
    target.classList.add("message-jump-highlight");
    target.addEventListener(
      "animationend",
      () => target.classList.remove("message-jump-highlight"),
      { once: true },
    );
  }

  #showTooltip(index: number) {
    if (!this.#tooltipEl) return;
    const root = this.#tooltipRoot;
    if (!root) return;
    const turn = this.#turns[index];
    if (!turn) return;
    if (this.#tooltipHideTimer) clearTimeout(this.#tooltipHideTimer);
    const q = tooltipUserPreview(turn.user);
    const a = tooltipAssistantPreview(turn.assistant);
    flushSync(() => {
      root.render(createElement(ConvNavTooltip, { q, a }));
    });

    this.#tooltipEl.classList.remove("hidden");
    const dotEl = this.#trackEl?.children[index] as HTMLElement | undefined;
    const dotRect = dotEl?.getBoundingClientRect();
    const tipHeight = this.#tooltipEl.offsetHeight || 90;
    const top = Math.max(
      8,
      Math.min(
        (dotRect?.top ?? 0) + (dotRect?.height ?? 0) / 2 - tipHeight / 2,
        window.innerHeight - tipHeight - 8,
      ),
    );
    this.#tooltipEl.style.top = `${top}px`;

    this.#tooltipEl.classList.remove("animating");
    void this.#tooltipEl.offsetWidth;
    this.#tooltipEl.classList.add("animating");
    this.#tooltipEl.addEventListener(
      "animationend",
      () => this.#tooltipEl?.classList.remove("animating"),
      { once: true },
    );
  }

  #hideTooltip() {
    if (!this.#tooltipEl) return;
    this.#tooltipHideTimer = setTimeout(
      () => this.#tooltipEl?.classList.add("hidden"),
      120,
    );
  }
}
