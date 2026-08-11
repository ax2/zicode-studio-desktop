import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
// @ts-expect-error plain JS module without type declarations (public/ui/markdown.js)
import { renderMarkdown, renderStreamingMarkdown, renderUserMarkdown } from "../../../../public/ui/markdown.js";
// @ts-expect-error plain JS module without type declarations (public/ui/copy.js)
import { copyText } from "../../../../public/ui/copy.js";
import {
  HistoryLoadedStatus,
  HistoryWindowNotice,
} from "../historyWindow/HistoryWindowNotices";
import { t } from "../../shared/i18n";
import {
  describeModelError,
  formatJson,
  renderDiffData,
  type ContentBlock,
} from "./chatLogic";
import type {
  ChatFeedItem,
  UserMessageLike,
  AssistantMessageLike,
  UsageLike,
  WelcomeScene,
} from "./chatFeedStore";

type ChatStore = {
  getState(): { items: ChatFeedItem[] };
  subscribe(listener: () => void): () => void;
};

function useChatStore(store: ChatStore): ChatFeedItem[] {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().items,
    () => store.getState().items,
  );
}

export function ChatMessageList({
  store,
  container,
  onOpenSceneSettings,
  onRevealHistory,
  openApp,
}: {
  store: ChatStore;
  container: HTMLElement;
  onOpenSceneSettings?: () => void;
  onRevealHistory?: () => void;
  openApp?: (pluginId: string) => void;
}) {
  const items = useChatStore(store);
  return (
    <>
      {items.map((item) => (
        <ChatItem
          key={item.seq}
          item={item}
          container={container}
          items={items}
          onOpenSceneSettings={onOpenSceneSettings}
          onRevealHistory={onRevealHistory}
          openApp={openApp}
        />
      ))}
    </>
  );
}

function ChatItem({
  item,
  container,
  items,
  onOpenSceneSettings,
  onRevealHistory,
  openApp,
}: {
  item: ChatFeedItem;
  container: HTMLElement;
  items: ChatFeedItem[];
  onOpenSceneSettings?: () => void;
  onRevealHistory?: () => void;
  openApp?: (pluginId: string) => void;
}) {
  switch (item.kind) {
    case "welcome":
      return (
        <WelcomeItem
          key={item.seq}
          workspacePath={item.workspacePath}
          scene={item.scene}
          onOpenSceneSettings={onOpenSceneSettings}
          openApp={openApp}
        />
      );
    case "user":
      return <UserMessage key={item.seq} item={item} container={container} />;
    case "assistant":
      return <AssistantMessage key={item.seq} item={item} container={container} items={items} />;
    case "system":
      return <SystemMessage key={item.seq} text={item.text} />;
    case "error":
      return <ErrorMessage key={item.seq} text={item.text} />;
    case "assistant-error":
      return <ModelErrorCard key={item.seq} message={item.message} container={container} />;
    case "notice":
      return (
        <div
          key={item.seq}
          className={item.className || "history-window-loaded"}
          tabIndex={-1}
        >
          <NoticeMount element={item.element} />
        </div>
      );
    case "history-window":
      return (
        <HistoryWindowNotice key={item.seq} onReveal={onRevealHistory} />
      );
    case "history-loaded":
      return <HistoryLoadedStatus key={item.seq} />;
    case "tool":
      return <ToolCard key={item.seq} item={item} />;
  }
}

function NoticeMount({ element }: { element: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !element) return;
    host.append(element);
  }, [element]);
  return <div ref={ref} />;
}

function Markdown({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return <div ref={ref} />;
}

const WelcomeItem = memo(function WelcomeItem({
  workspacePath,
  scene,
  onOpenSceneSettings,
  openApp,
}: {
  workspacePath?: string;
  scene: WelcomeScene | null;
  onOpenSceneSettings?: () => void;
  openApp?: (pluginId: string) => void;
}) {
  const sceneId = scene?.id ?? "programming";
  const sceneName = scene ? t(scene.name) : "Programming";
  const sceneDescription = scene
    ? t(scene.description)
    : "Engineering workflows for coding, debugging, repository changes, and reproducible verification.";
  const quickActions: Array<{ pluginId: string; label: string; icon: string }> = [
    { pluginId: "com.zicode.projects", label: t("Projects"), icon: "📁" },
    { pluginId: "com.zicode.notes", label: t("Notes"), icon: "📝" },
    { pluginId: "com.zicode.tasks", label: t("Tasks"), icon: "✅" },
    { pluginId: "com.zicode.automation", label: t("Automation"), icon: "⚙️" },
  ];
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-icon">
          <img
            src="icons/logo-dark.svg"
            alt="ZiCode Studio Desktop logo"
            className="tau-icon-welcome"
          />
        </div>
        <p>{t("Welcome to ZiCode Studio Desktop")}</p>
        <p className="hint">
          {t(
            "Type a message below to start chatting with Pi, or select a session from the sidebar.",
          )}
        </p>
        {workspacePath ? (
          <p className="hint welcome-workspace">
            {t("Current workspace:")} <code>{workspacePath}</code>
          </p>
        ) : null}
        <button
          className="welcome-scene"
          type="button"
          data-scene={sceneId}
          title={t("Open scene settings")}
          onClick={onOpenSceneSettings}
        >
          <span className="welcome-scene-dot" aria-hidden="true"></span>
          <span className="welcome-scene-copy">
            <span className="welcome-scene-kicker">{t("Current scene")}</span>
            <strong data-scene-name>{sceneName}</strong>
            <span data-scene-description>{sceneDescription}</span>
          </span>
        </button>
      </div>
      <div className="welcome-panel">
        {/* biome-ignore lint/a11y/useSemanticElements: ARIA group of app shortcuts kept as a plain div like the shortcuts-hint row */}
        <div className="welcome-quick-actions" role="group" aria-label={t("Quick actions")}>
          <button
            type="button"
            className="welcome-quick-action"
            data-quick-action="new-chat"
            onClick={() => {
              document.getElementById("message-input")?.focus();
            }}
          >
            <span className="welcome-quick-action-icon" aria-hidden="true">
              ✨
            </span>
            <span>{t("Start a new conversation")}</span>
          </button>
          {quickActions.map((action) => (
            <button
              key={action.pluginId}
              type="button"
              className="welcome-quick-action"
              data-quick-action={action.pluginId}
              onClick={() => openApp?.(action.pluginId)}
            >
              <span className="welcome-quick-action-icon" aria-hidden="true">
                {action.icon}
              </span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: ARIA group pattern preserved from the vanilla welcome */}
        <div className="shortcuts-hint" role="group" aria-label={t("Keyboard shortcuts")}>
          <span>
            <kbd>/</kbd> {t("Focus input")}
          </span>
          <span>
            <kbd>Esc</kbd> {t("Abort")}
          </span>
        </div>
      </div>
    </div>
  );
});

function imageItems(message: UserMessageLike): Array<{ data?: string; mimeType?: string }> {
  const items: Array<{ data?: string; mimeType?: string }> = [];
  if (message.images && message.images.length > 0) items.push(...message.images);
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type === "image" && block.data) items.push(block);
    }
  }
  if (message.attachments && message.attachments.length > 0) {
    for (const att of message.attachments) {
      if (att.type === "image" && att.content) {
        items.push({ data: att.content, mimeType: att.mimeType });
      }
    }
  }
  return items;
}

function UserMessage({
  item,
  container,
}: {
  item: Extract<ChatFeedItem, { kind: "user" }>;
  container: HTMLElement;
}) {
  const message = item.message;
  const images = imageItems(message);
  const rawContent = Array.isArray(message.content)
    ? message.content
        .filter((b) => b?.type === "text")
        .map((b) => b.text)
        .join("\n")
    : message.content;
  return (
    <div
      className={`message user${item.isHistory ? " history" : ""}`}
      data-entry-id={item.entryId ?? undefined}
    >
      <div className="message-content">
        {images.length > 0 ? (
          <div className="message-images">
            {images.map((img) => {
              const src = img.data?.startsWith("data:")
                ? img.data
                : `data:${img.mimeType || "image/png"};base64,${img.data}`;
              return (
                <img
                  key={src.slice(0, 64)}
                  className="message-image"
                  src={src}
                  alt={t("Attached image")}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              );
            })}
          </div>
        ) : null}
        <Markdown html={renderUserMarkdown(String(rawContent || ""))} />
      </div>
      <div className="message-footer">
        <CopyButton text={item.noteSourceText} />
        {item.entryId ? (
          <button
            type="button"
            className="message-fork-btn"
            aria-label={t("Fork session from here")}
            title={t("Fork session from here")}
            onClick={() =>
              container.dispatchEvent(
                new CustomEvent("messagefork", { bubbles: true, detail: { entryId: item.entryId } }),
              )
            }
          >
            <ForkIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function assistantParts(message: AssistantMessageLike) {
  const textBlocks: ContentBlock[] = [];
  let thinking: string | null = null;
  if (typeof message.content === "string") {
    textBlocks.push({ type: "text", text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === "text") textBlocks.push(block);
      else if (block.type === "thinking") thinking = block.thinking ?? "";
    }
  }
  return { textBlocks, thinking };
}

function AssistantMessage({
  item,
  container,
  items,
}: {
  item: Extract<ChatFeedItem, { kind: "assistant" }>;
  container: HTMLElement;
  items: ChatFeedItem[];
}) {
  const { textBlocks, thinking } = assistantParts(item.message);
  const streamingText = item.isStreaming ? item.streamingText : "";
  const hasText =
    item.isStreaming
      ? streamingText.trim().length > 0
      : textBlocks.some((block) => (block.text || "").trim().length > 0);
  const usageTotal = item.usage?.cost?.total;
  const showFooter = !item.isStreaming && (hasText || Boolean(usageTotal && usageTotal > 0));
  const usageHtml =
    usageTotal && usageTotal > 0 && !item.finalThinking && !thinking ? usageTotal : null;
  return (
    <div className={`message assistant${item.isHistory ? " history" : ""}`} data-message-id={item.message.id || "streaming"}>
      <div className={`message-content${item.isStreaming ? " streaming" : ""}`}>
        {item.isStreaming ? (
          <>
            {item.thinking ? <ThinkingBlock thinking={item.thinking} expanded /> : null}
            {streamingText ? (
              <div className="streaming-text">
                <Markdown html={renderStreamingMarkdown(streamingText)} />
              </div>
            ) : null}
          </>
        ) : (
          <>
            {item.finalThinking || thinking ? (
              <ThinkingBlock
                thinking={item.finalThinking || thinking || ""}
                cost={usageCost(item.usage)}
              />
            ) : null}
            {textBlocks.map((block) => (
              <Markdown key={block.text?.slice(0, 32) ?? "block"} html={renderMarkdown(block.text ?? "")} />
            ))}
          </>
        )}
      </div>
      {showFooter ? (
        <div className="message-footer">
          {hasText ? (
            <>
              <CopyButton text={item.noteSourceText} />
              <NoteButton item={item} container={container} items={items} />
              <OrganizeNoteButton container={container} />
              <ShareButton text={item.noteSourceText} />
            </>
          ) : null}
          {usageHtml != null ? (
            <span className="message-usage">${usageHtml.toFixed(4)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function usageCost(usage: UsageLike | null | undefined): number | undefined {
  return usage?.cost?.total;
}

function ThinkingBlock({
  thinking,
  cost,
  expanded = false,
}: {
  thinking: string;
  cost?: number;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  return (
    <div className="thinking-block">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: thinking toggle pattern preserved from the vanilla renderer */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: disclosure toggle mirrors the vanilla delegated click */}
      <div className={`thinking-toggle${open ? " expanded" : ""}`} data-thinking-toggle onClick={() => setOpen(!open)}>
        <span className="chevron">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
            <path d="M2 1l4 3-4 3z" />
          </svg>
        </span>
        <span className="thinking-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-1px" }} aria-hidden="true">
            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
            <path d="M12 5v13" />
            <path d="M6.5 9h11" />
            <path d="M7 13h10" />
          </svg>{" "}
          Thinking
        </span>
        {cost != null && cost > 0 ? (
          <span
            className="thinking-usage"
            title={t("Total cost for this response")}
          >
            ${cost.toFixed(4)}
          </span>
        ) : null}
      </div>
      <div className={`thinking-content${open ? " expanded" : ""}`}>{thinking}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  const [label, setLabel] = useState(t("Copy message"));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await copyText(text);
      setState("copied");
      setLabel(t("Copied"));
    } catch {
      setState("failed");
      setLabel(t("Copy failed"));
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState("");
      setLabel(t("Copy message"));
    }, 1500);
  };
  return (
    <button
      type="button"
      className={`message-copy-btn${state ? ` ${state}` : ""}`}
      aria-label={label}
      title={label}
      onClick={() => void copy()}
    >
      <CopyIcon />
    </button>
  );
}

function NoteButton({
  item,
  container,
  items,
}: {
  item: Extract<ChatFeedItem, { kind: "assistant" }>;
  container: HTMLElement;
  items: ChatFeedItem[];
}) {
  const question = (() => {
    const index = items.findIndex((entry) => entry.seq === item.seq);
    for (let i = index - 1; i >= 0; i -= 1) {
      const entry = items[i];
      if (entry.kind === "assistant") break;
      if (entry.kind === "user") return entry.noteSourceText;
    }
    return "";
  })();
  return (
    <button
      type="button"
      className="message-note-btn"
      aria-label={t("Save exchange to Notes")}
      title={t("Save exchange to Notes")}
      onClick={() => {
        container.dispatchEvent(
          new CustomEvent("savechattonotes", {
            bubbles: true,
            detail: { question, answer: item.noteSourceText },
          }),
        );
      }}
    >
      <NoteIcon />
    </button>
  );
}

function OrganizeNoteButton({ container }: { container: HTMLElement }) {
  return (
    <button
      type="button"
      className="message-organize-btn"
      aria-label={t("Organize conversation into note")}
      title={t("Organize conversation into note")}
      onClick={() => {
        container.dispatchEvent(
          new CustomEvent("organizechattonotes", { bubbles: true }),
        );
      }}
    >
      <OrganizeIcon />
    </button>
  );
}

function ShareButton({ text }: { text: string }) {
  // The desktop WebView exposes navigator.share but always rejects with
  // NotAllowedError, so a visible share button there would do nothing.
  // Hide it in Tauri; keep it on mobile browsers where share is real.
  const inTauriDesktop =
    typeof globalThis !== "undefined" &&
    Boolean((globalThis as Record<string, unknown>).__TAURI__);
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    !inTauriDesktop;
  if (!canShare) return null;
  return (
    <button
      type="button"
      className="message-share-btn"
      aria-label={t("Share answer")}
      title={t("Share answer")}
      onClick={() => {
        void navigator
          .share({ title: t("ZiCode answer"), text })
          .catch(() => {});
      }}
    >
      <ShareIcon />
    </button>
  );
}

function SystemMessage({ text }: { text: string }) {
  return <div className="system-message">{text}</div>;
}

function ErrorMessage({ text }: { text: string }) {
  return <div className="error-message">{text}</div>;
}

function ModelErrorCard({
  message,
  container,
}: {
  message: AssistantMessageLike;
  container: HTMLElement;
}) {
  const description = describeModelError(message as { errorMessage?: string; error?: string });
  return (
    <section className={`model-error-card model-error-card--${description.kind}`} role="alert">
      <span className="model-error-card__icon" aria-hidden="true">
        !
      </span>
      <div className="model-error-card__body">
        <strong className="model-error-card__title">{description.title}</strong>
        <p className="model-error-card__summary">{description.summary}</p>
        {description.metrics.length > 0 ? (
          <div className="model-error-card__metrics">
            {description.metrics
              .filter((metric): metric is { label: string; value: string } => Boolean(metric))
              .map((metric) => (
                <span key={metric.label} className="model-error-card__metric">
                  {metric.label} {metric.value}
                </span>
              ))}
          </div>
        ) : null}
        <p className="model-error-card__suggestion">{description.suggestion}</p>
        <div className="model-error-card__actions">
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={() => container.dispatchEvent(new CustomEvent("retrylastrequest", { bubbles: true }))}
          >
            {t("Retry request")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary model-error-card__action"
            onClick={() => container.dispatchEvent(new CustomEvent("openmodelsettings", { bubbles: true }))}
          >
            {t("Open model settings")}
          </button>
        </div>
      </div>
    </section>
  );
}

function ToolCard({ item }: { item: Extract<ChatFeedItem, { kind: "tool" }> }) {
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null);
  const expanded = localExpanded ?? item.expanded;
  const [copyState, setCopyState] = useState<"" | "copied" | "failed">("");
  const [copyLabel, setCopyLabel] = useState("Copy output");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);
  const argsPreview = getArgsPreview(item.toolName, item.args);
  const argsJson = formatJson(item.args);
  const isEdit =
    (item.toolName === "edit" || item.toolName === "Edit") &&
    item.args &&
    Boolean((item.args.oldText || item.args.old_text) && (item.args.newText || item.args.new_text));
  const copyOutput = async () => {
    if (!item.output.trim()) return;
    try {
      const ok = await copyText(item.output);
      if (!ok) throw new Error("Clipboard unavailable");
      setCopyState("copied");
      setCopyLabel("Tool output copied");
    } catch {
      setCopyState("failed");
      setCopyLabel("Unable to copy tool output. Check browser clipboard permission.");
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopyState("");
      setCopyLabel("Copy output");
    }, copyState === "failed" ? 5000 : 2000);
  };
  return (
    <div className="tool-card" data-tool-call-id={item.toolCallId}>
      <div className="tool-card-header">
        <button
          type="button"
          className="tool-card-toggle"
          aria-expanded={expanded}
          onClick={() => setLocalExpanded(!expanded)}
        >
          <span className="tool-header-left">
            <span className="tool-card-chevron">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                <path d="M2 1l4 3-4 3z" />
              </svg>
            </span>
            <span className="tool-name">{item.toolName}</span>
            {argsPreview ? <span className="tool-args-preview">{argsPreview}</span> : null}
          </span>
          <span className="tool-toggle-action">
            {expanded ? "Collapse tool details" : "Expand tool details"}
          </span>
        </button>
        <div className="tool-header-right">
          <button
            type="button"
            className="tool-action-btn copy-output-btn"
            title={t("Copy output")}
            aria-label={t("Copy output")}
            disabled={!item.output.trim() || Boolean(copyState)}
            onClick={() => void copyOutput()}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          </button>
          <div className={`tool-status ${item.status}`} role="status" aria-live="polite">
            {item.status}
          </div>
        </div>
        <span className={`tool-copy-status${copyState ? ` ${copyState}` : ""}`} role="status" aria-live="polite" aria-atomic="true">
          {copyLabel === "Copy output" ? "" : copyLabel}
        </span>
      </div>
      {expanded ? (
        <div className="tool-card-body expanded" id={`tool-card-body-${item.seq}`}>
          {isEdit ? (
            <div className="tool-diff">
              {renderDiffData(
                String(item.args.oldText || item.args.old_text || ""),
                String(item.args.newText || item.args.new_text || ""),
              ).map((line) => (
                <div key={`${line.kind}-${line.text.slice(0, 24)}`} className={`diff-line diff-${line.kind}`}>
                  {line.text}
                </div>
              ))}
            </div>
          ) : argsJson ? (
            <div className="tool-args">{argsJson}</div>
          ) : null}
          <div className="tool-output-wrapper">
            <div className="tool-output">{item.output}</div>
          </div>
        </div>
      ) : (
        <div className="tool-card-body" hidden>
          <div className="tool-output-wrapper">
            <div className="tool-output">{item.output}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function getArgsPreview(_toolName: string, args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  if (args.path) return String(args.path);
  if (args.command) return String(args.command).substring(0, 80);
  if (args.query) return String(args.query).substring(0, 60);
  if (args.url) return String(args.url);
  for (const val of Object.values(args)) {
    if (typeof val === "string" && val.length > 0) return val.substring(0, 60);
  }
  return "";
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </svg>
  );
}

function OrganizeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M9 13h6M9 17h4" />
      <path d="m17.5 4.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.7 6.8-4.4" />
      <path d="m8.6 13.3 6.8 4.4" />
    </svg>
  );
}
