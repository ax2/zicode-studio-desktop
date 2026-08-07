import { useRef } from "react";
import type { StoreApi, UseBoundStore } from "zustand";

export interface QueuedMessages {
  steering?: string[];
  followUp?: string[];
}

export interface ComposerStore {
  queue: QueuedMessages;
  setQueue(queue: QueuedMessages): void;
}

export type ComposerStoreHook = UseBoundStore<StoreApi<ComposerStore>>;

export function ComposerApp({
  store,
  onSubmit,
}: {
  store: ComposerStoreHook;
  onSubmit?: (options: { altKey: boolean }) => void;
}) {
  const queue = store((state) => state.queue);
  const composingRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCompositionReset = () => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  };

  const isImeComposing = (event?: React.KeyboardEvent) =>
    Boolean(
      (event as React.KeyboardEvent & { isComposing?: boolean; keyCode?: number })
        ?.isComposing ||
        (event as React.KeyboardEvent & { keyCode?: number })?.keyCode === 229 ||
        composingRef.current,
    );

  const queueItems = [
    ...(queue.steering ?? [])
      .map((message) => String(message ?? "").trim())
      .filter(Boolean)
      .map((message) => ({ label: "Steering", message })),
    ...(queue.followUp ?? [])
      .map((message) => String(message ?? "").trim())
      .filter(Boolean)
      .map((message) => ({ label: "Follow-up", message })),
  ];

  return (
    <>
      <div className={`queued-messages${queueItems.length ? "" : " hidden"}`} id="queued-messages">
        {queueItems.map((item) => (
          <div key={`${item.label}-${item.message}`} className="queued-msg">
            <span className="queued-msg-label">{item.label}</span>
            <span className="queued-msg-text">{item.message}</span>
          </div>
        ))}
      </div>
      <form
        id="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (isImeComposing()) return;
          onSubmit?.({ altKey: false });
        }}
      >
        <div className="composer-card" id="composer-card">
          <div className="skill-slash-menu hidden" id="skill-slash-menu"></div>
          <div className="image-previews hidden" id="image-previews"></div>
          <textarea
            id="message-input"
            placeholder="Type a message, or use / to call a skill…"
            autoComplete="off"
            rows={2}
            onCompositionStart={() => {
              clearCompositionReset();
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              clearCompositionReset();
              resetTimer.current = setTimeout(() => {
                composingRef.current = false;
                resetTimer.current = null;
              }, 0);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              if (isImeComposing(event)) return;
              event.preventDefault();
              onSubmit?.({ altKey: event.altKey });
            }}
          ></textarea>
          <div className="composer-toolbar">
            <div className="composer-toolbar-left">
              <button
                type="button"
                className="ui-icon-button ui-icon-button--sm ui-icon-button--ghost input-icon-btn"
                id="attach-btn"
                title="Attach image"
                aria-label="Attach image"
                tabIndex={-1}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button
                type="button"
                className="ui-icon-button ui-icon-button--sm ui-icon-button--ghost input-icon-btn"
                id="command-btn"
                title="Commands"
                aria-label="Open commands"
                tabIndex={-1}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22v-5" />
                  <path d="M9 8V2" />
                  <path d="M15 8V2" />
                  <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
                </svg>
              </button>
              <input type="file" id="image-input" accept="image/*" multiple style={{ display: "none" }} />
            </div>
            <div className="composer-toolbar-right">
              <div className="model-dropdown" id="model-dropdown">
                <button
                  type="button"
                  className="ui-button ui-button--sm ui-button--ghost model-dropdown-btn"
                  id="model-dropdown-btn"
                  title="Switch model"
                  tabIndex={-1}
                >
                  <span className="model-dropdown-label" id="model-dropdown-label">
                    model
                  </span>
                  <svg className="model-dropdown-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="model-dropdown-menu hidden" id="model-dropdown-menu"></div>
              </div>
              <button
                type="button"
                className="thinking-tag off"
                id="thinking-btn"
                title="Thinking effort controls reasoning depth. Click to cycle."
                aria-label="Thinking effort: off. Click to cycle reasoning depth."
                tabIndex={-1}
              >
                Think off
              </button>
              <button
                type="button"
                className="ui-icon-button ui-icon-button--sm ui-icon-button--ghost input-mic-btn"
                id="mic-btn"
                title="Voice input"
                tabIndex={-1}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </button>
              <button type="submit" id="send-btn" title="Send message" tabIndex={-1}>
                <span className="send-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </span>
              </button>
              <button type="button" id="abort-btn" className="hidden" title="Abort (Esc)" tabIndex={-1}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
