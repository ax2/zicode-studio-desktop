import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { create } from "zustand";
// @ts-expect-error plain JS module without type declarations (public/ui/image-lightbox.js)
import { initImageLightbox } from "../../../../public/ui/image-lightbox.js";
// @ts-expect-error plain JS module without type declarations (public/ui/markdown.js)
import { initCodeCopyDelegation } from "../../../../public/ui/markdown.js";
import {
  cleanChatTranscript,
  describeModelError,
  escapeRegExp,
  formatJson,
  formatResult,
  getArgsPreview,
  renderDiffData,
  splitStreamingContent,
  type ContentBlock,
} from "./chatLogic";
import { ChatMessageList } from "./ChatMessageList";

export interface UsageLike {
  cost?: { total?: number };
}

export interface WelcomeScene {
  id: string;
  name: string;
  description: string;
}

export interface UserMessageLike {
  content?: string | ContentBlock[];
  images?: Array<{ data?: string; mimeType?: string }>;
  attachments?: Array<{ type?: string; content?: string; mimeType?: string }>;
  entryId?: string;
  entry_id?: string;
}

export interface AssistantMessageLike {
  id?: string;
  content?: string | ContentBlock[];
  usage?: UsageLike;
  stopReason?: string;
  errorMessage?: string;
}

export type ChatFeedItem =
  | {
      kind: "welcome";
      seq: number;
      workspacePath?: string;
      scene: WelcomeScene | null;
    }
  | {
      kind: "user";
      seq: number;
      message: UserMessageLike;
      isHistory: boolean;
      entryId: string | null;
      noteSourceText: string;
    }
  | {
      kind: "assistant";
      seq: number;
      message: AssistantMessageLike;
      isHistory: boolean;
      isStreaming: boolean;
      streamingText: string;
      thinking: string;
      finalThinking: string;
      usage: UsageLike | null;
      noteSourceText: string;
      entryId: string | null;
    }
  | { kind: "system" | "error"; seq: number; text: string }
  | { kind: "assistant-error"; seq: number; message: AssistantMessageLike }
  | { kind: "notice"; seq: number; element: HTMLElement | null; className: string }
  | { kind: "history-window"; seq: number; hiddenCount: number }
  | { kind: "history-loaded"; seq: number }
  | {
      kind: "tool";
      seq: number;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      status: string;
      output: string;
      result: unknown;
      isError: boolean;
      history: boolean;
      expanded: boolean;
    };

export interface MessageHandle {
  seq: number;
}

interface ChatFeedState {
  items: ChatFeedItem[];
}

const AUTO_EXPAND_DELAY_MS = 200;

export class ChatFeed {
  private store = create<ChatFeedState>()(() => ({ items: [] }));
  private root: Root;
  private container: HTMLElement;
  private seq = 0;
  private toolByCallId = new Map<string, number>();
  private expandTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private isNearBottom = true;

  constructor(
    container: HTMLElement,
    options: {
      onOpenSceneSettings?: () => void;
      onRevealHistory?: () => void;
    } = {},
  ) {
    this.container = container;
    this.root = createRoot(container);
    this.root.render(
      createElement(ChatMessageList, {
        store: this.store,
        container,
        onOpenSceneSettings: options.onOpenSceneSettings,
        onRevealHistory: options.onRevealHistory,
      }),
    );
    initCodeCopyDelegation(container);
    initImageLightbox(container);
    container.addEventListener("scroll", () => {
      const threshold = 100;
      this.isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    });
  }

  getState() {
    return this.store.getState();
  }

  private setItems(items: ChatFeedItem[]) {
    this.store.setState({ items });
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  clear() {
    for (const timer of this.expandTimers.values()) clearTimeout(timer);
    this.expandTimers.clear();
    this.toolByCallId.clear();
    this.setItems([]);
    this.isNearBottom = true;
  }

  clearTools() {
    for (const timer of this.expandTimers.values()) clearTimeout(timer);
    this.expandTimers.clear();
    this.toolByCallId.clear();
    this.setItems(this.store.getState().items.filter((item) => item.kind !== "tool"));
  }

  renderWelcome(
    workspacePath?: string,
    scene: WelcomeScene | null = null,
  ) {
    const item: ChatFeedItem = {
      kind: "welcome",
      seq: this.nextSeq(),
      workspacePath,
      scene,
    };
    this.setItems([item]);
  }

  setWelcomeScene(scene: WelcomeScene | null) {
    const items = this.store.getState().items;
    this.setItems(
      items.map((item) =>
        item.kind === "welcome" ? { ...item, scene } : item,
      ),
    );
  }

  renderUserMessage(
    message: UserMessageLike,
    isHistory = false,
    { entryId = null }: { entryId?: string | null } = {},
  ) {
    const rawContent = Array.isArray(message.content)
      ? message.content
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
      : message.content;
    const displayContent = cleanChatTranscript(String(rawContent || "")) ?? String(rawContent || "");
    const forkEntryId = entryId ?? message.entryId ?? message.entry_id ?? null;
    const items = this.store.getState().items.filter((item) => item.kind !== "welcome");
    const item: ChatFeedItem = {
      kind: "user",
      seq: this.nextSeq(),
      message,
      isHistory,
      entryId: forkEntryId ?? null,
      noteSourceText: String(displayContent || ""),
    };
    this.setItems([...items, item]);
    if (!isHistory) this.scrollToBottom();
  }

  renderAssistantMessage(
    message: AssistantMessageLike,
    isStreaming = false,
    isHistory = false,
  ): MessageHandle | null {
    const items = this.store.getState().items.filter((item) => item.kind !== "welcome");
    let rawStreamingText = "";
    if (typeof message.content === "string") {
      rawStreamingText = message.content;
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text") rawStreamingText += block.text ?? "";
      }
    }
    const contentHtml = Array.isArray(message.content)
      ? message.content.some((block) => block.type === "text" || block.type === "thinking")
      : true;
    if (!isStreaming && isHistory && !contentHtml) return null;
    const item: ChatFeedItem = {
      kind: "assistant",
      seq: this.nextSeq(),
      message,
      isHistory,
      isStreaming,
      streamingText: isStreaming ? rawStreamingText : "",
      thinking: "",
      finalThinking: "",
      usage: isStreaming ? null : (message.usage ?? null),
      noteSourceText: rawStreamingText,
      entryId: null,
    };
    this.setItems([...items, item]);
    if (!isHistory) this.scrollToBottom();
    return { seq: item.seq };
  }

  updateStreamingMessage(handle: MessageHandle, content: unknown) {
    const { text, thinking } = splitStreamingContent(content);
    const items = this.store.getState().items.map((item) => {
      if (item.kind !== "assistant" || item.seq !== handle.seq) return item;
      return {
        ...item,
        streamingText: text,
        thinking: thinking || item.thinking,
        noteSourceText: text,
      };
    });
    this.setItems(items);
    this.scrollToBottom();
  }

  finalizeStreamingMessage(handle: MessageHandle, usage: UsageLike | null = null, thinking = "") {
    const items = this.store.getState().items.map((item) => {
      if (item.kind !== "assistant" || item.seq !== handle.seq) return item;
      const finalThinking = thinking || item.thinking || "";
      const hasText = item.noteSourceText.trim().length > 0;
      const total = usage?.cost?.total;
      const hasUsage = Boolean(total && total > 0 && !finalThinking);
      if (!hasText && !hasUsage) return null;
      return {
        ...item,
        isStreaming: false,
        finalThinking,
        usage,
        thinking: "",
        entryId: item.entryId,
      };
    });
    this.setItems(items.filter((item): item is ChatFeedItem => item !== null));
  }

  renderSystemMessage(text: string) {
    const items = this.store.getState().items;
    this.setItems([...items, { kind: "system", seq: this.nextSeq(), text }]);
    this.scrollToBottom();
  }

  renderError(errorMessage: string) {
    const items = this.store.getState().items;
    this.setItems([...items, { kind: "error", seq: this.nextSeq(), text: `⚠️ ${errorMessage}` }]);
    this.scrollToBottom();
  }

  renderAssistantError(message: AssistantMessageLike): MessageHandle {
    const items = this.store.getState().items;
    const seq = this.nextSeq();
    this.setItems([...items, { kind: "assistant-error", seq, message }]);
    this.scrollToBottom();
    return { seq };
  }

  appendNoticeElement(element: HTMLElement, className = "") {
    const items = this.store.getState().items;
    this.setItems([...items, { kind: "notice", seq: this.nextSeq(), element, className }]);
  }

  appendHistoryWindowNotice(hiddenCount: number) {
    const items = this.store.getState().items;
    this.setItems([
      ...items,
      { kind: "history-window", seq: this.nextSeq(), hiddenCount },
    ]);
  }

  appendHistoryLoadedStatus() {
    const items = this.store.getState().items;
    this.setItems([...items, { kind: "history-loaded", seq: this.nextSeq() }]);
  }

  private toolItem(toolExecution: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status?: string;
  }): Extract<ChatFeedItem, { kind: "tool" }> {
    const { toolCallId, toolName, args, status = "pending" } = toolExecution;
    return {
      kind: "tool",
      seq: this.nextSeq(),
      toolCallId,
      toolName,
      args: args ?? {},
      status,
      output: "",
      result: null,
      isError: false,
      history: false,
      expanded: false,
    };
  }

  private scheduleAutoExpand(toolCallId: string) {
    if (this.expandTimers.has(toolCallId)) return;
    const timer = setTimeout(() => {
      this.expandTimers.delete(toolCallId);
      const items = this.store.getState().items.map((item) =>
        item.kind === "tool" && item.toolCallId === toolCallId ? { ...item, expanded: true } : item,
      );
      this.setItems(items);
    }, AUTO_EXPAND_DELAY_MS);
    this.expandTimers.set(toolCallId, timer);
  }

  createToolCard(toolExecution: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status?: string;
  }): MessageHandle {
    const item = this.toolItem(toolExecution);
    const items = this.store.getState().items;
    this.toolByCallId.set(item.toolCallId, item.seq);
    this.setItems([...items, item]);
    this.scrollToBottom();
    if (item.status === "pending" || item.status === "streaming") {
      this.scheduleAutoExpand(item.toolCallId);
    }
    return { seq: item.seq };
  }

  updateToolCard(toolExecution: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status?: string;
    output?: string;
  }) {
    let seq = this.toolByCallId.get(toolExecution.toolCallId);
    if (seq === undefined) {
      const handle = this.createToolCard(toolExecution);
      seq = handle.seq;
    }
    const items = this.store.getState().items.map((item) =>
      item.kind === "tool" && item.seq === seq
        ? {
            ...item,
            status: toolExecution.status ?? item.status,
            output: toolExecution.output ?? item.output,
          }
        : item,
    );
    this.setItems(items);
    if (toolExecution.status === "streaming") {
      this.scheduleAutoExpand(toolExecution.toolCallId);
    }
    if (toolExecution.output) this.scrollToBottom();
  }

  finalizeToolCard(toolCallId: string, result: unknown, isError: boolean) {
    const seq = this.toolByCallId.get(toolCallId);
    if (seq === undefined) return;
    const timer = this.expandTimers.get(toolCallId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.expandTimers.delete(toolCallId);
    }
    const status = isError ? "error" : "complete";
    const output = result ? formatResult(result) : "";
    const items = this.store.getState().items.map((item) =>
      item.kind === "tool" && item.seq === seq
        ? { ...item, status, output, result, isError, expanded: Boolean(isError) }
        : item,
    );
    this.setItems(items);
  }

  createHistoryCard(toolExecution: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): MessageHandle {
    const item: Extract<ChatFeedItem, { kind: "tool" }> = {
      ...this.toolItem({ ...toolExecution, status: "complete" }),
      history: true,
    };
    this.toolByCallId.set(item.toolCallId, item.seq);
    const items = this.store.getState().items;
    this.setItems([...items, item]);
    return { seq: item.seq };
  }

  addHistoryResult(toolCallId: string, result: unknown, isError: boolean) {
    const seq = this.toolByCallId.get(toolCallId);
    if (seq === undefined) return;
    const output = result ? formatResult(result) : "";
    const items = this.store.getState().items.map((item) =>
      item.kind === "tool" && item.seq === seq
        ? {
            ...item,
            output,
            result,
            isError,
            status: isError ? "error" : item.status,
            expanded: isError ? true : item.expanded,
          }
        : item,
    );
    this.setItems(items);
  }

  expandAll() {
    const items = this.store.getState().items.map((item) =>
      item.kind === "tool" ? { ...item, expanded: true } : item,
    );
    this.setItems(items);
  }

  collapseAll() {
    const items = this.store.getState().items.map((item) =>
      item.kind === "tool" ? { ...item, expanded: false } : item,
    );
    this.setItems(items);
  }

  clearSearchHighlights() {
    const marks = this.container.querySelectorAll("mark[data-search-highlight='true']");
    marks.forEach((mark) => {
      const text = document.createTextNode(mark.textContent || "");
      mark.replaceWith(text);
      text.parentNode?.normalize();
    });
  }

  highlightSearchQuery(query: string, { scrollToFirst = true } = {}): number {
    this.clearSearchHighlights();
    // Ensure any pending React commits are flushed so the DOM walk sees the
    // freshly rendered message content.
    flushSync(() => {});
    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    if (!normalizedQuery) return 0;
    const pattern = new RegExp(escapeRegExp(normalizedQuery), "gi");
    let matchCount = 0;
    const firstMatches: HTMLElement[] = [];
    this.container.querySelectorAll(".message-content").forEach((content) => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
          if ((node.parentElement as HTMLElement | null)?.closest?.("mark[data-search-highlight='true']")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const textNodes: Text[] = [];
      let currentNode = walker.nextNode();
      while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = walker.nextNode();
      }
      textNodes.forEach((node) => {
        matchCount += this.highlightTextNode(node, pattern, (mark) => {
          firstMatches.push(mark);
        });
      });
    });
    const firstMatch = firstMatches[0] ?? null;
    if (scrollToFirst && firstMatch && typeof firstMatch.scrollIntoView === "function") {
      const target = firstMatch;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return matchCount;
  }

  private highlightTextNode(
    node: Text,
    pattern: RegExp,
    onMatch: (mark: HTMLElement) => void,
  ): number {
    const text = node.nodeValue ?? "";
    if (!text) return 0;
    const matches: Array<{ start: number; end: number }> = [];
    const globalPattern = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null = globalPattern.exec(text);
    while (match !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) globalPattern.lastIndex += 1;
      match = globalPattern.exec(text);
    }
    if (matches.length === 0) return 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const { start, end } of matches) {
      if (start > cursor) fragment.append(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.dataset.searchHighlight = "true";
      mark.textContent = text.slice(start, end);
      fragment.append(mark);
      onMatch(mark);
      cursor = end;
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
    return matches.length;
  }

  scrollToBottom() {
    if (this.isNearBottom) {
      flushSync(() => {});
      requestAnimationFrame(() => {
        this.container.scrollTop = this.container.scrollHeight;
      });
    }
  }

  forceScrollToBottom() {
    flushSync(() => {});
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
    });
  }

  getCopyableText(): string {
    return "";
  }

  destroy() {
    for (const timer of this.expandTimers.values()) clearTimeout(timer);
    this.expandTimers.clear();
    this.root.unmount();
  }

  static describeModelError(message: { errorMessage?: string; error?: string } = {}) {
    return describeModelError(message);
  }

  static splitStreamingContent(content: unknown) {
    return splitStreamingContent(content);
  }

  static getArgsPreview(toolName: string, args?: Record<string, unknown>) {
    return getArgsPreview(toolName, args);
  }

  static formatJson(obj: unknown) {
    return formatJson(obj);
  }

  static formatResult(result: unknown) {
    return formatResult(result);
  }

  static renderDiffData(oldText: string, newText: string) {
    return renderDiffData(oldText, newText);
  }
}

const feeds = new WeakMap<HTMLElement, ChatFeed>();

export function feedFor(
  container: HTMLElement,
  options?: {
    onOpenSceneSettings?: () => void;
    onRevealHistory?: () => void;
  },
): ChatFeed {
  let feed = feeds.get(container);
  if (!feed) {
    feed = new ChatFeed(container, options);
    feeds.set(container, feed);
  }
  return feed;
}
