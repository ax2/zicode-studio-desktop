/**
 * Tool Card - Renders and updates tool execution cards (collapsible)
 */

// Minimum time a tool call must stay in-flight before its card auto-expands.
// Tools that finish faster than this never visibly expand, avoiding an
// expand-then-immediately-collapse flash on quick tool calls.
const AUTO_EXPAND_DELAY_MS = 200;
let toolCardSequence = 0;

export class ToolCardRenderer {
  constructor(container) {
    this.container = container;
    this.toolCards = new Map(); // toolCallId -> element
    this.expandTimers = new Map(); // toolCallId -> timeout id

    // Toggle tool details via event delegation.
    this.container.addEventListener("click", (e) => {
      const toggle = e.target.closest(".tool-card-toggle");
      if (!toggle) return;
      const card = toggle.closest(".tool-card");
      if (!card) return;
      const body = card.querySelector(".tool-card-body");
      this.setExpanded(card, body?.hidden !== false);
    });

    // Copy output via event delegation
    this.container.addEventListener("click", async (e) => {
      const btn = e.target.closest(".copy-output-btn");
      if (!btn || btn.disabled) return;
      e.stopPropagation();
      const output = btn.closest(".tool-card")?.querySelector(".tool-output");
      if (!output?.textContent.trim()) return;
      const copyStatus = btn
        .closest(".tool-card-header")
        ?.querySelector(".tool-copy-status");
      btn.disabled = true;
      btn.classList.remove("copied", "failed");
      if (copyStatus) {
        copyStatus.textContent = "";
        delete copyStatus.dataset.state;
      }
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(output.textContent);
        btn.classList.add("copied");
        if (copyStatus) {
          copyStatus.textContent = "Tool output copied";
          copyStatus.dataset.state = "copied";
        }
      } catch {
        btn.classList.add("failed");
        if (copyStatus) {
          copyStatus.textContent =
            "Unable to copy tool output. Check browser clipboard permission.";
          copyStatus.dataset.state = "failed";
        }
      }
      const resetDelay = btn.classList.contains("failed") ? 5000 : 2000;
      setTimeout(() => {
        btn.classList.remove("copied", "failed");
        btn.disabled = !output.textContent.trim();
        if (copyStatus) {
          copyStatus.textContent = "";
          delete copyStatus.dataset.state;
        }
      }, resetDelay);
    });
  }

  createHeader(toolName, argsPreview, status, bodyId) {
    const header = document.createElement("div");
    header.className = "tool-card-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tool-card-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", bodyId);

    const headerLeft = document.createElement("span");
    headerLeft.className = "tool-header-left";
    const chevron = document.createElement("span");
    chevron.className = "tool-card-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.innerHTML =
      '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M2 1l4 3-4 3z"/></svg>';
    const name = document.createElement("span");
    name.className = "tool-name";
    name.id = `${bodyId}-name`;
    name.textContent = toolName;
    headerLeft.append(chevron, name);
    if (argsPreview) {
      const preview = document.createElement("span");
      preview.className = "tool-args-preview";
      preview.textContent = argsPreview;
      headerLeft.appendChild(preview);
    }
    const action = document.createElement("span");
    action.className = "tool-toggle-action";
    action.id = `${bodyId}-action`;
    action.textContent = "Expand tool details";
    toggle.setAttribute("aria-labelledby", `${name.id} ${action.id}`);
    toggle.append(headerLeft, action);

    const headerRight = document.createElement("div");
    headerRight.className = "tool-header-right";
    const copyStatus = document.createElement("span");
    copyStatus.className = "tool-copy-status";
    copyStatus.setAttribute("role", "status");
    copyStatus.setAttribute("aria-live", "polite");
    copyStatus.setAttribute("aria-atomic", "true");
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "tool-action-btn copy-output-btn";
    copyButton.title = "Copy output";
    copyButton.setAttribute("aria-label", "Copy output");
    copyButton.disabled = true;
    copyButton.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    const statusElement = document.createElement("div");
    statusElement.className = `tool-status ${status}`;
    statusElement.setAttribute("role", "status");
    statusElement.setAttribute("aria-live", "polite");
    statusElement.textContent = status;
    headerRight.append(copyButton, statusElement);
    header.append(toggle, headerRight, copyStatus);
    return header;
  }

  setExpanded(card, expanded) {
    const body = card?.querySelector(".tool-card-body");
    const toggle = card?.querySelector(".tool-card-toggle");
    if (!body || !toggle) return;
    body.hidden = !expanded;
    body.classList.toggle("expanded", expanded);
    card.querySelector(".tool-card-chevron")?.classList.toggle("expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    const action = toggle.querySelector(".tool-toggle-action");
    if (action) action.textContent = expanded ? "Collapse tool details" : "Expand tool details";
  }

  syncCopyAvailability(card) {
    const output = card?.querySelector(".tool-output");
    const button = card?.querySelector(".copy-output-btn");
    if (!button || button.classList.contains("copied") || button.classList.contains("failed")) return;
    button.disabled = !output?.textContent.trim();
  }

  createToolCard(toolExecution) {
    const { toolCallId, toolName, args, status } = toolExecution;

    const card = document.createElement("div");
    card.className = "tool-card";
    card.dataset.toolCallId = toolCallId;

    const argsPreview = this.getArgsPreview(toolName, args);
    const argsJson = this.formatJson(args);
    const bodyId = `tool-card-body-${++toolCardSequence}`;
    // Cards never start expanded — see scheduleAutoExpand() below. This avoids
    // an expand-then-immediately-collapse flash for tool calls that resolve
    // faster than AUTO_EXPAND_DELAY_MS.

    const isEdit =
      (toolName === "edit" || toolName === "Edit") &&
      args &&
      (args.oldText || args.old_text) &&
      (args.newText || args.new_text);

    card.innerHTML = `
      <div class="tool-card-body" id="${bodyId}" hidden>
        ${!isEdit && argsJson ? `<div class="tool-args">${this.escapeHtml(argsJson)}</div>` : ""}
        <div class="tool-output-wrapper">
          <div class="tool-output"></div>
        </div>
      </div>
    `;
    card.prepend(this.createHeader(toolName, argsPreview, status, bodyId));

    // Insert diff view for Edit tools
    if (isEdit) {
      const diffEl = this.renderDiff(args.oldText || args.old_text, args.newText || args.new_text);
      const body = card.querySelector(".tool-card-body");
      body.insertBefore(diffEl, body.firstChild);
    }

    this.container.appendChild(card);
    this.toolCards.set(toolCallId, card);
    this.scrollToBottom();

    if (status === "pending" || status === "streaming") {
      this.scheduleAutoExpand(toolCallId, card);
    }

    return card;
  }

  /**
   * Auto-expand a card only after it has been in-flight for AUTO_EXPAND_DELAY_MS.
   * Idempotent: a card that already has a pending timer (or is already
   * expanded) is left alone, so the delay is always measured from the first
   * pending/streaming event rather than restarted on every update.
   */
  scheduleAutoExpand(toolCallId, card) {
    if (this.expandTimers.has(toolCallId)) return;
    if (card.querySelector(".tool-card-body")?.classList.contains("expanded")) return;
    const timer = setTimeout(() => {
      this.expandTimers.delete(toolCallId);
      this.setExpanded(card, true);
    }, AUTO_EXPAND_DELAY_MS);
    this.expandTimers.set(toolCallId, timer);
  }

  /** Cancel a pending auto-expand timer, e.g. once the tool has finished. */
  cancelAutoExpand(toolCallId) {
    const timer = this.expandTimers.get(toolCallId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.expandTimers.delete(toolCallId);
  }

  updateToolCard(toolExecution) {
    let card = this.toolCards.get(toolExecution.toolCallId);

    if (!card) {
      card = this.createToolCard(toolExecution);
    }

    // Update status
    const statusElement = card.querySelector(".tool-status");
    if (statusElement) {
      statusElement.className = `tool-status ${toolExecution.status}`;
      statusElement.textContent = toolExecution.status;
    }

    // Auto-expand when streaming, but only after the debounce delay (see
    // scheduleAutoExpand) so brief tool calls never visibly flash open.
    if (toolExecution.status === "streaming") {
      this.scheduleAutoExpand(toolExecution.toolCallId, card);
    }

    // Update output
    const outputElement = card.querySelector(".tool-output");
    if (outputElement && toolExecution.output) {
      outputElement.textContent = toolExecution.output;
      this.syncCopyAvailability(card);
      this.scrollToBottom();
    }
  }

  finalizeToolCard(toolCallId, result, isError) {
    const card = this.toolCards.get(toolCallId);
    if (!card) return;

    // Cancel any pending auto-expand — the tool is done, so there's no need
    // to expand it just to immediately collapse it again below.
    this.cancelAutoExpand(toolCallId);

    // Update status
    const statusElement = card.querySelector(".tool-status");
    if (statusElement) {
      const status = isError ? "error" : "complete";
      statusElement.className = `tool-status ${status}`;
      statusElement.textContent = status;
    }

    // Update output with final result
    const outputElement = card.querySelector(".tool-output");
    if (outputElement && result) {
      const output = this.formatResult(result);
      outputElement.textContent = output;
      this.syncCopyAvailability(card);
    }

    // Keep errors visible and collapse successful cards to reduce noise.
    this.setExpanded(card, Boolean(isError));
  }

  /**
   * Create a pre-collapsed card for session history using DOM methods (no innerHTML)
   */
  createHistoryCard(toolExecution) {
    const { toolCallId, toolName, args } = toolExecution;

    const card = document.createElement("div");
    card.className = "tool-card";
    card.dataset.toolCallId = toolCallId;

    const preview = this.getArgsPreview(toolName, args);
    const bodyId = `tool-card-body-${++toolCardSequence}`;
    card.appendChild(this.createHeader(toolName, preview, "complete", bodyId));

    // Body (collapsed by default)
    const body = document.createElement("div");
    body.className = "tool-card-body";
    body.id = bodyId;
    body.hidden = true;

    const isEdit =
      (toolName === "edit" || toolName === "Edit") &&
      args &&
      (args.oldText || args.old_text) &&
      (args.newText || args.new_text);

    if (isEdit) {
      body.appendChild(
        this.renderDiff(args.oldText || args.old_text, args.newText || args.new_text),
      );
    } else {
      const argsJson = this.formatJson(args);
      if (argsJson) {
        const argsEl = document.createElement("div");
        argsEl.className = "tool-args";
        argsEl.textContent = argsJson;
        body.appendChild(argsEl);
      }
    }

    const outputEl = document.createElement("div");
    outputEl.className = "tool-output";
    body.appendChild(outputEl);

    card.appendChild(body);

    this.container.appendChild(card);
    this.toolCards.set(toolCallId, card);

    return card;
  }

  /**
   * Add result to a history card (stays collapsed)
   */
  addHistoryResult(toolCallId, result, isError) {
    const card = this.toolCards.get(toolCallId);
    if (!card) return;

    if (isError) {
      const statusEl = card.querySelector(".tool-status");
      if (statusEl) {
        statusEl.className = "tool-status error";
        statusEl.textContent = "error";
      }
    }

    const outputElement = card.querySelector(".tool-output");
    if (outputElement && result) {
      outputElement.textContent = this.formatResult(result);
      this.syncCopyAvailability(card);
    }
    if (isError) this.setExpanded(card, true);
  }

  /** Compact preview for the header line */
  getArgsPreview(_toolName, args) {
    if (!args || Object.keys(args).length === 0) return "";

    // Show the most relevant arg inline
    if (args.path) return args.path;
    if (args.command) return args.command.substring(0, 80);
    if (args.query) return args.query.substring(0, 60);
    if (args.url) return args.url;

    // Fallback: first string value
    for (const val of Object.values(args)) {
      if (typeof val === "string" && val.length > 0) {
        return val.substring(0, 60);
      }
    }
    return "";
  }

  formatJson(obj) {
    try {
      if (Object.keys(obj).length === 0) return "";
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  /** Render a simple inline diff for Edit tool */
  renderDiff(oldText, newText) {
    const container = document.createElement("div");
    container.className = "tool-diff";

    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");

    // Removed lines
    for (const line of oldLines) {
      const el = document.createElement("div");
      el.className = "diff-line diff-removed";
      el.textContent = `- ${line}`;
      container.appendChild(el);
    }

    // Added lines
    for (const line of newLines) {
      const el = document.createElement("div");
      el.className = "diff-line diff-added";
      el.textContent = `+ ${line}`;
      container.appendChild(el);
    }

    return container;
  }

  formatResult(result) {
    if (!result) return "";

    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((block) => {
          if (block.type === "text") return block.text;
          return JSON.stringify(block);
        })
        .join("\n");
    }

    return JSON.stringify(result, null, 2);
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  scrollToBottom() {
    if (this.container) {
      const threshold = 100;
      const isNear =
        this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight <
        threshold;
      if (isNear) {
        requestAnimationFrame(() => {
          this.container.scrollTop = this.container.scrollHeight;
        });
      }
    }
  }

  expandAll() {
    this.toolCards.forEach((card) => {
      this.setExpanded(card, true);
    });
  }

  collapseAll() {
    this.toolCards.forEach((card) => {
      this.setExpanded(card, false);
    });
  }

  clear() {
    this.toolCards.forEach((card) => {
      card.remove();
    });
    this.toolCards.clear();
    this.expandTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.expandTimers.clear();
  }
}
