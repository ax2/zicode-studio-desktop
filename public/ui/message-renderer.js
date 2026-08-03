/**
 * Message Renderer - Renders chat messages with markdown support
 */

import { initImageLightbox } from "./image-lightbox.js";
import { t } from "../i18n.js";
import {
  initCodeCopyDelegation,
  renderMarkdown,
  renderStreamingMarkdown,
  renderUserMarkdown,
} from "./markdown.js";

/**
 * Detect and clean up pi-chat transcript format.
 *
 * Old format: `- [ISO-timestamp] [uid:ID] name: text`
 * New format:  `- [uid:ID] name: text`
 *
 * Returns the cleaned text (just `name: text` per line, deduplicated when
 * all lines share the same speaker), or null if the content doesn't look
 * like a chat transcript.
 */
function cleanChatTranscript(text) {
  if (!text || typeof text !== "string") return null;
  // Match both old (with timestamp) and new (without) formats
  const lineRe = /^- (?:\[[\dT:.Z+-]+\] )?\[uid:[^\]]+\] ([^:]+): (.*)$/;
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const parsed = lines.map((l) => {
    const m = l.match(lineRe);
    return m ? { name: m[1].trim(), text: m[2] } : null;
  });
  if (parsed.some((p) => p === null)) return null; // mixed content – don't touch
  const names = [...new Set(parsed.map((p) => p.name))];
  // Single speaker: just show the text lines
  if (names.length === 1) {
    return parsed.map((p) => p.text).join("\n");
  }
  // Multiple speakers: show `name: text`
  return parsed.map((p) => `**${p.name}**: ${p.text}`).join("\n\n");
}

export function describeModelError(message = {}) {
  const raw = String(message?.errorMessage || message?.error || "");
  const quotaFailure = /insufficient_user_quota|预扣费额度失败|insufficient\s+(?:user\s+)?quota/i.test(
    raw,
  );
  const available = raw.match(/用户剩余额度\s*[:：]\s*[＄$]?\s*([\d.]+)/i)?.[1];
  const required = raw.match(/需要预扣费额度\s*[:：]\s*[＄$]?\s*([\d.]+)/i)?.[1];

  if (quotaFailure) {
    return {
      kind: "quota",
      title: t("QVeris quota is insufficient"),
      summary: t("The model service could not reserve enough balance for this request."),
      suggestion: t(
        "Try a less expensive model, start a new conversation to reduce context, or top up QVeris.",
      ),
      metrics: [
        available ? { label: t("Available balance"), value: `$${available}` } : null,
        required ? { label: t("Required reservation"), value: `$${required}` } : null,
      ].filter(Boolean),
    };
  }

  if (/\b401\b|unauthorized|invalid[_ -]?api[_ -]?key|authentication/i.test(raw)) {
    return {
      kind: "authentication",
      title: t("Model authentication failed"),
      summary: t("The model gateway rejected the configured credential."),
      suggestion: t("Update the API key in the current scene and try again."),
      metrics: [],
    };
  }

  if (/\b429\b|rate[_ -]?limit|too many requests/i.test(raw)) {
    return {
      kind: "rate-limit",
      title: t("The model service is busy"),
      summary: t("The request was rate limited by the model gateway."),
      suggestion: t("Wait a moment, then try again or choose another model."),
      metrics: [],
    };
  }

  return {
    kind: "generic",
    title: t("Model request failed"),
    summary: t("The model did not return a usable response."),
    suggestion: t("Check the current scene's model channel, then try again."),
    metrics: [],
  };
}

export class MessageRenderer {
  constructor(container) {
    this.container = container;
    this.isNearBottom = true;

    // Wire up code-block copy buttons via event delegation
    initCodeCopyDelegation(this.container);

    // Wire up image lightbox
    initImageLightbox(this.container);

    // Wire up thinking-block toggle buttons via event delegation
    this.container.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-thinking-toggle]");
      if (!toggle) return;
      const block = toggle.closest(".thinking-block");
      if (!block) return;
      const content = block.querySelector(".thinking-content");
      if (content) content.classList.toggle("expanded");
      toggle.classList.toggle("expanded");
    });

    // Track scroll position for smart auto-scroll
    this.container.addEventListener("scroll", () => {
      const threshold = 100;
      this.isNearBottom =
        this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight <
        threshold;
    });
  }

  clear() {
    this.container.innerHTML = "";
    // Session switches reuse the same renderer instance. If the previous session
    // left the viewport away from bottom, keep new renders from inheriting that
    // stale anchor state (which can suppress auto-scroll until the user scrolls).
    this.isNearBottom = true;
  }

  clearSearchHighlights() {
    const marks = this.container.querySelectorAll("mark[data-search-highlight='true']");
    marks.forEach((mark) => {
      const text = document.createTextNode(mark.textContent || "");
      mark.replaceWith(text);
      text.parentNode?.normalize();
    });
  }

  highlightSearchQuery(query, { scrollToFirst = true } = {}) {
    this.clearSearchHighlights();

    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    if (!normalizedQuery) return 0;

    const pattern = new RegExp(this.escapeRegExp(normalizedQuery), "gi");
    let matchCount = 0;
    let firstMatch = null;

    this.container.querySelectorAll(".message-content").forEach((content) => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest("mark[data-search-highlight='true']")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes = [];
      let currentNode = walker.nextNode();
      while (currentNode) {
        textNodes.push(currentNode);
        currentNode = walker.nextNode();
      }

      textNodes.forEach((node) => {
        const count = this.highlightTextNode(node, pattern, (mark) => {
          if (!firstMatch) firstMatch = mark;
        });
        matchCount += count;
      });
    });

    if (scrollToFirst && firstMatch && typeof firstMatch.scrollIntoView === "function") {
      firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    return matchCount;
  }

  renderWelcome({ workspacePath } = {}) {
    const workspaceHtml = workspacePath
      ? `<p class="hint welcome-workspace">Current workspace: <code>${this.escapeHtml(workspacePath)}</code></p>`
      : "";
    this.container.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon"><img src="icons/logo-dark.svg" alt="ZiCode Studio Desktop logo" class="tau-icon-welcome"></div>
        <p>Welcome to ZiCode Studio Desktop</p>
        <p class="hint">Type a message below to start chatting with Pi, or select a session from the sidebar.</p>
        ${workspaceHtml}
        <button class="welcome-scene" type="button" data-scene="programming" title="Open scene settings">
          <span class="welcome-scene-dot" aria-hidden="true"></span>
          <span class="welcome-scene-copy">
            <span class="welcome-scene-kicker">Current scene</span>
            <strong data-scene-name>Programming</strong>
            <span data-scene-description>Engineering workflows for coding, debugging, repository changes, and reproducible verification.</span>
          </span>
        </button>
        <div class="shortcuts-hint" aria-label="Keyboard shortcuts">
          <span><kbd>/</kbd> Focus input</span>
          <span><kbd>Esc</kbd> Abort</span>
        </div>
      </div>
    `;
  }

  renderUserMessage(message, isHistory = false, { entryId = null } = {}) {
    // Remove welcome message if present
    const welcome = this.container.querySelector(".welcome");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = `message user${isHistory ? " history" : ""}`;

    // Collect images from all sources: message.images, content image blocks, attachments
    const imageItems = [];
    if (message.images && message.images.length > 0) {
      imageItems.push(...message.images);
    }
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type === "image" && block.data) {
          imageItems.push(block);
        }
      }
    }
    if (message.attachments && message.attachments.length > 0) {
      for (const att of message.attachments) {
        if (att.type === "image" && att.content) {
          imageItems.push({ data: att.content, mimeType: att.mimeType });
        }
      }
    }
    let imagesHtml = "";
    if (imageItems.length > 0) {
      imagesHtml =
        '<div class="message-images">' +
        imageItems
          .map((img) => {
            const src = img.data.startsWith("data:")
              ? img.data
              : `data:${img.mimeType || "image/png"};base64,${img.data}`;
            return `<img class="message-image" src="${src}" alt="${t("Attached image")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
          })
          .join("") +
        "</div>";
    }

    // Normalise content: Pi RPC user messages may carry an array of content blocks
    // ({type:"text",text:"..."}  or {type:"image",...}).  Extract the text parts so
    // downstream string-only helpers (cleanChatTranscript, renderUserMarkdown) work.
    const rawContent = Array.isArray(message.content)
      ? message.content
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
      : message.content;
    const displayContent = cleanChatTranscript(rawContent) ?? rawContent;
    div._noteSourceText = String(displayContent || "");
    const forkEntryId = entryId ?? message.entryId ?? message.entry_id ?? null;
    if (forkEntryId) div.dataset.entryId = forkEntryId;
    const forkLabel = t("Fork session from here");
    const forkBtnHtml = forkEntryId
      ? `<button class="message-fork-btn" aria-label="${forkLabel}" title="${forkLabel}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></button>`
      : "";
    div.innerHTML = `
      <div class="message-content">${imagesHtml}${renderUserMarkdown(displayContent)}</div>
      <div class="message-footer"><button class="message-copy-btn" aria-label="${t("Copy message")}" title="${t("Copy message")}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>${forkBtnHtml}</div>
    `;
    this._setupCopyBtn(div);
    if (forkEntryId) this._setupForkBtn(div);
    this.container.appendChild(div);
    if (!isHistory) this.scrollToBottom();
  }

  renderAssistantMessage(message, isStreaming = false, isHistory = false) {
    // Remove welcome message if present
    const welcome = this.container.querySelector(".welcome");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = `message assistant${isHistory ? " history" : ""}`;
    div.dataset.messageId = message.id || "streaming";

    let contentHtml = "";
    let usageHtml = "";
    let rawStreamingText = "";
    let hasThinking = false;

    if (typeof message.content === "string") {
      rawStreamingText = message.content;
      contentHtml = isStreaming
        ? renderStreamingMarkdown(message.content)
        : renderMarkdown(message.content);
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text") {
          rawStreamingText += block.text;
          contentHtml += isStreaming
            ? renderStreamingMarkdown(block.text)
            : renderMarkdown(block.text);
        } else if (block.type === "thinking") {
          hasThinking = true;
          contentHtml += this.renderThinkingBlock(block.thinking, message.usage?.cost?.total);
        }
      }
    }
    // Markdown is rendered live during streaming, so the raw text (with its
    // syntax markers) can't be recovered from the DOM at finalize time.
    if (isStreaming) {
      div._streamingRawText = rawStreamingText;
    }

    const hasText = rawStreamingText.trim().length > 0;

    // Usage/cost info — suppressed here when a thinking block is present,
    // since the thinking header already surfaces the same total cost inline.
    if (message.usage?.cost && !hasThinking) {
      const cost = message.usage.cost.total;
      if (cost > 0) {
        usageHtml = `<span class="message-usage">$${cost.toFixed(4)}</span>`;
      }
    }

    const streamingClass = isStreaming ? " streaming" : "";

    // Skip history messages that have no renderable text/thinking content
    // (e.g. assistant messages that only contain toolCall blocks — those are
    // already rendered by ToolCardRenderer).
    if (!isStreaming && isHistory && !contentHtml) return null;

    // Only render a footer when there's something meaningful in it: real
    // copyable text (not just a thinking block, which has nothing to copy)
    // or a non-thinking usage badge.
    const showFooter = !isStreaming && (hasText || usageHtml);
    const footerHtml = showFooter
      ? `<div class="message-footer">${hasText ? `<button class="message-copy-btn" aria-label="${t("Copy message")}" title="${t("Copy message")}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button><button class="message-note-btn" aria-label="${t("Save exchange to Notes")}" title="${t("Save exchange to Notes")}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg></button>${this._shareButtonMarkup()}` : ""}${usageHtml}</div>`
      : "";

    div.innerHTML = `
      <div class="message-content${streamingClass}">${contentHtml}</div>
      ${footerHtml}
    `;

    div._noteSourceText = rawStreamingText;
    if (!isStreaming && hasText) {
      this._setupCopyBtn(div);
      this._setupNoteBtn(div);
      this._setupShareBtn(div);
    }
    this.container.appendChild(div);
    if (!isHistory) this.scrollToBottom();

    return div;
  }

  renderThinkingBlock(thinking, cost) {
    // Returns an HTML string — callers concatenate it into contentHtml.
    // Click handling is wired via event delegation in initThinkingToggleDelegation.
    const chevronSvg = `<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><path d="M2 1l4 3-4 3z"/></svg>`;
    const brainSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M6.5 9h11"/><path d="M7 13h10"/></svg>`;
    const costHtml = this._thinkingCostHtml(cost);
    return `<div class="thinking-block"><div class="thinking-toggle" data-thinking-toggle><span class="chevron">${chevronSvg}</span><span class="thinking-label">${brainSvg} Thinking</span>${costHtml}</div><div class="thinking-content">${this.escapeHtml(thinking)}</div></div>`;
  }

  /** Small inline cost badge appended to the thinking header row (no extra line). */
  _thinkingCostHtml(cost) {
    if (!(cost > 0)) return "";
    return `<span class="thinking-usage" title="Total cost for this response">$${cost.toFixed(4)}</span>`;
  }

  updateStreamingThinking(messageElement, thinking) {
    let thinkingDiv = messageElement.querySelector(".streaming-thinking");
    if (!thinkingDiv) {
      const contentDiv = messageElement.querySelector(".message-content");
      if (!contentDiv) return;
      thinkingDiv = document.createElement("div");
      thinkingDiv.className = "thinking-block streaming-thinking";
      thinkingDiv.innerHTML = `
        <div class="thinking-toggle expanded" data-thinking-toggle>
          <span class="chevron"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M2 1l4 3-4 3z"/></svg></span>
          <span class="thinking-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M6.5 9h11"/><path d="M7 13h10"/></svg> Thinking</span>
        </div>
        <div class="thinking-content expanded"></div>`;
      contentDiv.prepend(thinkingDiv);
    }
    const contentEl = thinkingDiv.querySelector(".thinking-content");
    if (contentEl) {
      contentEl.textContent = thinking;
      this.scrollToBottom();
    }
  }

  updateStreamingMessage(messageElement, content) {
    const contentDiv = messageElement.querySelector(".message-content");
    if (!contentDiv) return;

    // The RPC stream may hand us either a plain string (legacy/tests) or the
    // full AgentMessage content array ({type:"text"|"thinking", ...}). Extract
    // the text so downstream markdown rendering never sees `[object Object]`.
    const { text, thinking } = this.splitStreamingContent(content);

    if (thinking) this.updateStreamingThinking(messageElement, thinking);

    messageElement._streamingRawText = text;
    // Keep any thinking block, update only the text part
    const thinkingBlock = contentDiv.querySelector(".streaming-thinking");
    const rendered = renderStreamingMarkdown(text);
    if (thinkingBlock) {
      // Remove everything after the thinking block and re-add text
      let textNode = contentDiv.querySelector(".streaming-text");
      if (!textNode) {
        textNode = document.createElement("div");
        textNode.className = "streaming-text";
        contentDiv.appendChild(textNode);
      }
      textNode.innerHTML = rendered;
    } else {
      contentDiv.innerHTML = rendered;
    }
    this.scrollToBottom();
  }

  /**
   * Normalise streaming `message.content` (string, or AgentMessage content
   * array) into separate text/thinking strings.
   */
  splitStreamingContent(content) {
    if (typeof content === "string") return { text: content, thinking: "" };
    if (!Array.isArray(content)) return { text: "", thinking: "" };
    let text = "";
    let thinking = "";
    for (const block of content) {
      if (block?.type === "text") text += block.text ?? "";
      else if (block?.type === "thinking") thinking += block.thinking ?? "";
    }
    return { text, thinking };
  }

  finalizeStreamingMessage(messageElement, usage = null, thinking = "") {
    const contentDiv = messageElement.querySelector(".message-content");
    let finalThinking = "";
    if (contentDiv) {
      contentDiv.classList.remove("streaming");
      // Prefer the raw text stashed during streaming — the DOM now holds
      // rendered markdown, so textContent has lost the syntax markers.
      const streamingText = contentDiv.querySelector(".streaming-text");
      const domText = streamingText ? streamingText.textContent : contentDiv.textContent;
      const rawText =
        typeof messageElement._streamingRawText === "string"
          ? messageElement._streamingRawText
          : domText;
      messageElement._noteSourceText = rawText;
      messageElement._streamingRawText = null;

      // Fall back to the thinking text accumulated during streaming (via
      // updateStreamingThinking) if the caller didn't pass one explicitly.
      finalThinking =
        thinking ||
        contentDiv.querySelector(".streaming-thinking .thinking-content")?.textContent ||
        "";

      // Rebuild with thinking block (if any) + markdown text
      let html = "";
      if (finalThinking) {
        html += this.renderThinkingBlock(finalThinking, usage?.cost?.total);
      }
      html += renderMarkdown(rawText);
      contentDiv.innerHTML = html;
    }

    // Add footer (usage + copy button) after streaming finishes
    if (!messageElement.querySelector(".message-footer")) {
      const copyableText = this.getCopyableText(messageElement);
      // Suppress the footer usage badge when a thinking block is present —
      // its header already surfaces the same total cost inline.
      const hasUsage = Boolean(usage?.cost && usage.cost.total > 0 && !finalThinking);
      if (!copyableText && !hasUsage) {
        messageElement.remove();
        return;
      }

      const footer = document.createElement("div");
      footer.className = "message-footer";

      if (copyableText) {
        const btn = document.createElement("button");
        btn.className = "message-copy-btn";
        btn.setAttribute("aria-label", t("Copy message"));
        btn.title = t("Copy message");
        btn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        footer.appendChild(btn);

        const noteButton = document.createElement("button");
        noteButton.className = "message-note-btn";
        noteButton.setAttribute("aria-label", t("Save exchange to Notes"));
        noteButton.title = t("Save exchange to Notes");
        noteButton.innerHTML =
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>';
        footer.appendChild(noteButton);

        if (this._canShare()) {
          const shareButton = document.createElement("button");
          shareButton.className = "message-share-btn";
          shareButton.setAttribute("aria-label", t("Share answer"));
          shareButton.title = t("Share answer");
          shareButton.innerHTML =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4.4"/><path d="m8.6 13.3 6.8 4.4"/></svg>';
          footer.appendChild(shareButton);
        }
      }

      if (hasUsage) {
        const span = document.createElement("span");
        span.className = "message-usage";
        span.textContent = `$${usage.cost.total.toFixed(4)}`;
        footer.appendChild(span);
      }

      messageElement.appendChild(footer);
      this._setupCopyBtn(messageElement);
      this._setupNoteBtn(messageElement);
      this._setupShareBtn(messageElement);
    }
  }

  _canShare() {
    return typeof navigator !== "undefined" && typeof navigator.share === "function";
  }

  _shareButtonMarkup() {
    if (!this._canShare()) return "";
    const label = t("Share answer");
    return `<button class="message-share-btn" aria-label="${label}" title="${label}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4.4"/><path d="m8.6 13.3 6.8 4.4"/></svg></button>`;
  }

  async _copyText(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  _showTemporaryButtonFeedback(button, state, label, duration = 1500) {
    button.classList.add(state);
    button.dataset.feedback = label;
    const originalLabel = button.getAttribute("aria-label");
    button.setAttribute("aria-label", label);
    window.setTimeout(() => {
      button.classList.remove(state);
      delete button.dataset.feedback;
      if (originalLabel) button.setAttribute("aria-label", originalLabel);
    }, duration);
  }

  _setupShareBtn(messageElement) {
    const button = messageElement.querySelector(".message-share-btn");
    if (!button || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const text = this.getCopyableText(messageElement);
      if (!text) return;
      try {
        await navigator.share({ title: t("ZiCode answer"), text });
      } catch (error) {
        if (error?.name === "AbortError") return;
        try {
          await this._copyText(text);
          this._showTemporaryButtonFeedback(button, "copied", t("Copied"));
        } catch {
          this._showTemporaryButtonFeedback(button, "failed", t("Share failed"), 2000);
        }
      }
    });
  }

  _setupNoteBtn(messageElement) {
    const button = messageElement.querySelector(".message-note-btn");
    if (!button || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      let previousMessage = messageElement.previousElementSibling;
      while (previousMessage && !previousMessage.matches?.(".message.user")) {
        if (previousMessage.matches?.(".message.assistant")) break;
        previousMessage = previousMessage.previousElementSibling;
      }
      const previousUser = previousMessage?.matches?.(".message.user") ? previousMessage : null;
      this.container.dispatchEvent(
        new CustomEvent("savechattonotes", {
          bubbles: true,
          detail: {
            question: previousUser?._noteSourceText || previousUser?.textContent?.trim() || "",
            answer: messageElement._noteSourceText || this.getCopyableText(messageElement),
          },
        }),
      );
    });
  }

  renderSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;
    this.container.appendChild(div);
    this.scrollToBottom();
  }

  renderError(errorMessage) {
    const div = document.createElement("div");
    div.className = "error-message";
    div.textContent = `⚠️ ${errorMessage}`;
    this.container.appendChild(div);
    this.scrollToBottom();
  }

  renderAssistantError(message) {
    const description = describeModelError(message);
    const card = document.createElement("section");
    card.className = `model-error-card model-error-card--${description.kind}`;
    card.setAttribute("role", "alert");

    const icon = document.createElement("span");
    icon.className = "model-error-card__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    const body = document.createElement("div");
    body.className = "model-error-card__body";
    const title = document.createElement("strong");
    title.className = "model-error-card__title";
    title.textContent = description.title;
    const summary = document.createElement("p");
    summary.className = "model-error-card__summary";
    summary.textContent = description.summary;
    body.append(title, summary);

    if (description.metrics.length > 0) {
      const metrics = document.createElement("div");
      metrics.className = "model-error-card__metrics";
      for (const metric of description.metrics) {
        const item = document.createElement("span");
        item.className = "model-error-card__metric";
        item.textContent = `${metric.label} ${metric.value}`;
        metrics.appendChild(item);
      }
      body.appendChild(metrics);
    }

    const suggestion = document.createElement("p");
    suggestion.className = "model-error-card__suggestion";
    suggestion.textContent = description.suggestion;
    const actions = document.createElement("div");
    actions.className = "model-error-card__actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ui-button ui-button--primary";
    retry.textContent = t("Retry request");
    retry.addEventListener("click", () => {
      card.dispatchEvent(new CustomEvent("retrylastrequest", { bubbles: true }));
    });
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "ui-button ui-button--secondary model-error-card__action";
    settings.textContent = t("Open model settings");
    settings.addEventListener("click", () => {
      card.dispatchEvent(new CustomEvent("openmodelsettings", { bubbles: true }));
    });
    actions.append(retry, settings);
    body.append(suggestion, actions);
    card.append(icon, body);
    this.container.appendChild(card);
    this.scrollToBottom();
    return card;
  }

  _setupForkBtn(messageEl) {
    const btn = messageEl.querySelector(".message-fork-btn");
    if (!btn) return;
    const entryId = messageEl.dataset.entryId;
    if (!entryId) return;
    btn.addEventListener("click", () => {
      messageEl.dispatchEvent(
        new CustomEvent("messagefork", {
          bubbles: true,
          detail: { entryId },
        }),
      );
    });
  }

  _setupCopyBtn(messageEl) {
    const btn = messageEl.querySelector(".message-copy-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const text = this.getCopyableText(messageEl);
      if (!text) return;
      this._copyText(text).then(() => {
        btn.classList.add("copied");
        setTimeout(() => {
          btn.classList.remove("copied");
        }, 1500);
      });
    });
  }

  getCopyableText(messageEl) {
    const content = messageEl.querySelector(".message-content");
    if (!content) return "";
    const copyContent = content.cloneNode(true);
    copyContent.querySelectorAll(".thinking-block").forEach((block) => {
      block.remove();
    });
    return copyContent.textContent.trim();
  }

  highlightTextNode(node, pattern, onMatch) {
    const text = node.textContent || "";
    const regex = new RegExp(pattern.source, pattern.flags);
    let lastIndex = 0;
    let matchCount = 0;
    let match = regex.exec(text);
    if (!match) return 0;

    const fragment = document.createDocumentFragment();
    while (match) {
      const [matchedText] = match;
      const start = match.index;
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }

      const mark = document.createElement("mark");
      mark.dataset.searchHighlight = "true";
      mark.textContent = matchedText;
      fragment.appendChild(mark);
      if (typeof onMatch === "function") onMatch(mark);

      matchCount += 1;
      lastIndex = start + matchedText.length;
      match = regex.exec(text);
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.replaceWith(fragment);
    return matchCount;
  }

  escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  scrollToBottom() {
    if (this.isNearBottom) {
      this.forceScrollToBottom();
    }
  }

  forceScrollToBottom() {
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
    });
  }
}
