import { useRef } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import {
  activeSlashQuery,
  computeSlashMatches,
  EMPTY_SLASH_STATE,
  scopeLabel,
  titleCaseCommandName,
  typeLabel,
  type SlashCommand,
  type SlashMenuState,
} from "./slashMenu";

export interface QueuedMessages {
  steering?: string[];
  followUp?: string[];
}

export interface ComposerStore {
  queue: QueuedMessages;
  setQueue(queue: QueuedMessages): void;
  slash: SlashMenuState;
  setSlash(patch: Partial<SlashMenuState>): void;
  getCommands: () => SlashCommand[];
  setGetCommands(getCommands: () => SlashCommand[]): void;
}

export type ComposerStoreHook = UseBoundStore<StoreApi<ComposerStore>>;

function clampSelectedIndex(index: number, length: number): number {
  return Math.min(index, Math.max(length - 1, 0));
}

export function ComposerApp({
  store,
  onSubmit,
}: {
  store: ComposerStoreHook;
  onSubmit?: (options: { altKey: boolean }) => void;
}) {
  const queue = store((state) => state.queue);
  const slash = store((state) => state.slash);
  const composingRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

  const updateSlashFromInput = (input: HTMLTextAreaElement) => {
    const state = store.getState();
    const computed = computeSlashMatches(input, state.getCommands());
    if (!computed) {
      state.setSlash(EMPTY_SLASH_STATE);
      return;
    }
    state.setSlash({
      open: true,
      query: computed.query,
      matches: computed.matches,
      selectedIndex: clampSelectedIndex(
        state.slash.selectedIndex,
        computed.matches.length,
      ),
    });
  };

  const selectSlashCommand = (
    index: number,
    input: HTMLTextAreaElement,
  ) => {
    const state = store.getState();
    const command = state.slash.matches[index];
    const active = activeSlashQuery(input);
    if (!command?.command || !active) return;
    const suffix = input.value.slice(active.end);
    input.value = `${command.command} ${suffix}`;
    input.setSelectionRange(command.command.length + 1, command.command.length + 1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    state.setSlash(EMPTY_SLASH_STATE);
  };

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
          <div
            className={`skill-slash-menu${slash.open ? "" : " hidden"}`}
            id="skill-slash-menu"
            role="listbox"
            aria-label="Skill slash commands"
          >
            <div className="skill-slash-heading">Skills</div>
            {slash.matches.length === 0 ? (
              <div className="skill-slash-empty">No matching skills</div>
            ) : (
              slash.matches.map((command, index) => (
                <button
                  type="button"
                  key={command.command}
                  id={`skill-slash-option-${index}`}
                  className={`skill-slash-option${index === slash.selectedIndex ? " selected" : ""}`}
                  role="option"
                  aria-selected={index === slash.selectedIndex}
                  onMouseEnter={() =>
                    store.getState().setSlash({ selectedIndex: index })
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (inputRef.current) {
                      selectSlashCommand(index, inputRef.current);
                    }
                  }}
                >
                  <span className="skill-slash-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6Z" />
                      <path d="m4.3 7.6 7.7 4.5 7.7-4.5M12 12.1v8.7M8 5.1l8 4.6" />
                    </svg>
                  </span>
                  <span className="skill-slash-name">
                    {titleCaseCommandName(command.name)}
                  </span>
                  <span className="skill-slash-description">
                    {command.description || typeLabel(command)}
                  </span>
                  <span className="skill-slash-scope">
                    {scopeLabel(command.scope)}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="image-previews hidden" id="image-previews"></div>
          <textarea
            ref={inputRef}
            id="message-input"
            placeholder="Type a message, or use / to call a skill…"
            autoComplete="off"
            rows={2}
            aria-autocomplete="list"
            aria-controls="skill-slash-menu"
            aria-activedescendant={
              slash.open && slash.matches.length > 0
                ? `skill-slash-option-${slash.selectedIndex}`
                : undefined
            }
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
            onInput={(event) => {
              updateSlashFromInput(event.currentTarget);
            }}
            onClick={(event) => {
              updateSlashFromInput(event.currentTarget);
            }}
            onBlur={() => {
              queueMicrotask(() => store.getState().setSlash(EMPTY_SLASH_STATE));
            }}
            onKeyDown={(event) => {
              if (isImeComposing(event)) return;
              const input = event.currentTarget;
              const state = store.getState();
              if (event.key === "Escape" && (state.slash.open || activeSlashQuery(input))) {
                event.preventDefault();
                state.setSlash(EMPTY_SLASH_STATE);
                return;
              }
              if (state.slash.open) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (state.slash.matches.length === 0) return;
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  const next =
                    (state.slash.selectedIndex + delta + state.slash.matches.length) %
                    state.slash.matches.length;
                  state.setSlash({ selectedIndex: next });
                  return;
                }
                if (
                  (event.key === "Enter" || event.key === "Tab") &&
                  state.slash.matches.length > 0
                ) {
                  event.preventDefault();
                  selectSlashCommand(state.slash.selectedIndex, input);
                  return;
                }
              }
              if (event.key !== "Enter" || event.shiftKey) return;
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
