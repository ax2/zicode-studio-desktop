import { t } from "../../shared/i18n";
import {
  describeModelError,
  escapeHtml,
  formatJson,
  formatResult,
  getArgsPreview,
  renderDiffData,
  splitStreamingContent,
} from "./chatLogic";
import {
  ChatFeed,
  feedFor,
  type AssistantMessageLike,
  type MessageHandle,
  type UserMessageLike,
  type WelcomeScene,
} from "./chatFeedStore";

export class MessageRenderer {
  private feed: ChatFeed;

  constructor(
    container: HTMLElement,
    options: {
      onOpenSceneSettings?: () => void;
      onRevealHistory?: () => void;
      openApp?: (pluginId: string) => void;
    } = {},
  ) {
    this.feed = feedFor(container, options);
  }

  clear() {
    this.feed.clear();
  }

  clearSearchHighlights() {
    this.feed.clearSearchHighlights();
  }

  highlightSearchQuery(query: string, options: { scrollToFirst?: boolean } = {}) {
    return this.feed.highlightSearchQuery(query, options);
  }

  renderWelcome({ workspacePath }: { workspacePath?: string } = {}) {
    this.feed.renderWelcome(workspacePath);
  }

  setWelcomeScene(scene: WelcomeScene | null) {
    this.feed.setWelcomeScene(scene);
  }

  renderUserMessage(
    message: UserMessageLike,
    isHistory = false,
    options: { entryId?: string | null } = {},
  ) {
    this.feed.renderUserMessage(message, isHistory, options);
  }

  renderAssistantMessage(
    message: AssistantMessageLike,
    isStreaming = false,
    isHistory = false,
  ): MessageHandle | null {
    return this.feed.renderAssistantMessage(message, isStreaming, isHistory);
  }

  updateStreamingMessage(handle: MessageHandle, content: unknown) {
    this.feed.updateStreamingMessage(handle, content);
  }

  finalizeStreamingMessage(handle: MessageHandle, usage: unknown = null, thinking = "") {
    this.feed.finalizeStreamingMessage(
      handle,
      usage as { cost?: { total?: number } } | null,
      thinking,
    );
  }

  renderSystemMessage(text: string) {
    this.feed.renderSystemMessage(text);
  }

  renderError(errorMessage: string) {
    this.feed.renderError(errorMessage);
  }

  renderAssistantError(message: AssistantMessageLike): MessageHandle {
    return this.feed.renderAssistantError(message);
  }

  appendNoticeElement(element: HTMLElement, className = "") {
    this.feed.appendNoticeElement(element, className);
  }

  appendHistoryWindowNotice(hiddenCount: number) {
    this.feed.appendHistoryWindowNotice(hiddenCount);
  }

  appendHistoryLoadedStatus() {
    this.feed.appendHistoryLoadedStatus();
  }

  scrollToBottom() {
    this.feed.scrollToBottom();
  }

  forceScrollToBottom() {
    this.feed.forceScrollToBottom();
  }

  getCopyableText() {
    return this.feed.getCopyableText();
  }

  splitStreamingContent(content: unknown) {
    return splitStreamingContent(content);
  }

  static describeModelError(message: { errorMessage?: string; error?: string } = {}) {
    return describeModelError(message);
  }
}

export class ToolCardRenderer {
  private feed: ChatFeed;

  constructor(container: HTMLElement) {
    this.feed = feedFor(container);
  }

  clear() {
    this.feed.clearTools();
  }

  createToolCard(toolExecution: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status?: string;
  }): MessageHandle {
    return this.feed.createToolCard(toolExecution);
  }

  updateToolCard(toolExecution: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status?: string;
    output?: string;
  }) {
    this.feed.updateToolCard(toolExecution);
  }

  finalizeToolCard(toolCallId: string, result: unknown, isError: boolean) {
    this.feed.finalizeToolCard(toolCallId, result, isError);
  }

  createHistoryCard(toolExecution: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): MessageHandle {
    return this.feed.createHistoryCard(toolExecution);
  }

  addHistoryResult(toolCallId: string, result: unknown, isError: boolean) {
    this.feed.addHistoryResult(toolCallId, result, isError);
  }

  expandAll() {
    this.feed.expandAll();
  }

  collapseAll() {
    this.feed.collapseAll();
  }

  scrollToBottom() {
    this.feed.scrollToBottom();
  }

  getArgsPreview(toolName: string, args?: Record<string, unknown>) {
    return getArgsPreview(toolName, args);
  }

  formatJson(obj: unknown) {
    return formatJson(obj);
  }

  formatResult(result: unknown) {
    return formatResult(result);
  }

  renderDiff(oldText: string, newText: string) {
    return renderDiffData(oldText, newText);
  }

  escapeHtml(text: unknown) {
    return escapeHtml(text);
  }
}

export { t };
export { ChatFeed, feedFor };
export { describeModelError, splitStreamingContent };
