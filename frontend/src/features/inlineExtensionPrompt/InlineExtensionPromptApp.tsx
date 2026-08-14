import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { t } from "../../shared/i18n";
import {
  isTypeSomethingOption,
  parseOption,
  parseOptionsFromBody,
  type DialogContent,
  type DialogOption,
  type InlinePromptRequest,
} from "./inlineExtensionPromptLogic";

function OptionBody({ option }: { option: DialogOption }) {
  return (
    <span className="inline-prompt-option-body">
      {option.number ? (
        <span className="inline-prompt-option-index">{option.number}</span>
      ) : null}
      <span className="inline-prompt-option-text">
        <span className="inline-prompt-option-label">{option.label}</span>
        {option.description ? (
          <span className="inline-prompt-option-description">{option.description}</span>
        ) : null}
      </span>
    </span>
  );
}

function PreviewPanel({
  preview,
}: {
  preview: DialogContent["previews"][number] | null;
}) {
  if (!preview) {
    return <div className="inline-prompt-preview-empty">{t("No preview")}</div>;
  }
  return (
    <>
      <div className="inline-prompt-preview-title">
        {preview.number}. {preview.label}
      </div>
      <pre className="inline-prompt-preview-body">{preview.content}</pre>
    </>
  );
}

function Actions({
  onSubmit,
  onCancel,
}: {
  onSubmit?(): void;
  onCancel(): void;
}) {
  return (
    <div className="inline-prompt-actions">
      {onSubmit ? (
        <button type="button" className="inline-prompt-submit" onClick={onSubmit}>
          {t("Submit")}
        </button>
      ) : null}
      <button type="button" className="inline-prompt-cancel" onClick={onCancel}>
        {t("Cancel")}
      </button>
    </div>
  );
}

export function InlineExtensionPromptCard({
  request,
  content,
  dismissSignal,
  onSettle,
  onCustomAnswer,
}: {
  request: InlinePromptRequest;
  content: DialogContent;
  dismissSignal?: Promise<unknown>;
  onSettle(result: { value?: unknown; cancelled?: boolean }): void;
  onCustomAnswer(value: string): void;
}) {
  const [answered, setAnswered] = useState<{ cancelled: boolean } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customSentinel, setCustomSentinel] = useState<unknown>(null);
  const [customActive, setCustomActive] = useState(false);
  const [preview, setPreview] = useState<DialogContent["previews"][number] | null>(
    content.previews[0] ?? null,
  );
  const settledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const multiCustomRef = useRef<HTMLInputElement | null>(null);
  const optionsListRef = useRef<HTMLDivElement | null>(null);

  const settle = (result: { value?: unknown; cancelled?: boolean }) => {
    if (settledRef.current) return;
    settledRef.current = true;
    flushSync(() => {
      setAnswered({ cancelled: Boolean(result.cancelled) });
    });
    onSettle(result);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: dismissSignal resolves once; settle is captured on mount
  useEffect(() => {
    if (dismissSignal) {
      dismissSignal.then(
        () => settle({ cancelled: true }),
        () => settle({ cancelled: true }),
      );
    }
  }, [dismissSignal]);

  const previewByNumber = new Map(
    content.previews.map((item) => [item.number, item]),
  );
  const multiOptions =
    request.method === "input" ? parseOptionsFromBody(content.body) : [];

  const showPreview = (option: DialogOption) => {
    if (option.number) setPreview(previewByNumber.get(option.number) ?? null);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: inline prompt card group pattern preserved from the vanilla renderer
    <div
      className={`inline-prompt-card${answered ? " answered" : ""}`}
      role="group"
      aria-label={t("Extension question")}
    >
      <div className="inline-prompt-header">
        <span className="inline-prompt-eyebrow">{content.header || t("Question")}</span>
        <div className="inline-prompt-title">{content.title || t("Choose an option")}</div>
      </div>

      {request.method === "select" ? (
        <div
          className={`inline-prompt-layout${
            content.previews.length > 0 ? " inline-prompt-layout--with-preview" : ""
          }`}
          hidden={customOpen}
        >
          <div className="inline-prompt-options" ref={optionsListRef}>
            {(request.options ?? []).map((value) => {
              const option = parseOptionValue(value);
              return (
                <button
                  type="button"
                  className="inline-prompt-option"
                  key={String(value)}
                    disabled={answered !== null}
                    onMouseEnter={() => showPreview(option)}
                    onFocus={() => showPreview(option)}
                    onClick={() => {
                      if (isTypeSomethingOption(option)) {
                        setCustomSentinel(value);
                        setCustomOpen(true);
                        flushSync(() => {});
                        return;
                      }
                      settle({ value });
                  }}
                >
                  <OptionBody option={option} />
                </button>
              );
            })}
          </div>
          {content.previews.length > 0 ? (
            <div className="inline-prompt-preview">
              <PreviewPanel preview={preview} />
            </div>
          ) : null}
        </div>
      ) : multiOptions.length > 0 ? (
        <>
          <div className="inline-prompt-options" ref={optionsListRef}>
            {multiOptions.map((option) => {
              return (
                <label
                  className="inline-prompt-option inline-prompt-option--checkbox"
                  key={option.number}
                >
                  <input
                    type="checkbox"
                    value={option.number}
                    disabled={answered !== null || customActive}
                  />
                  <OptionBody option={option} />
                </label>
              );
            })}
          </div>
          <input
            ref={multiCustomRef}
            className="inline-prompt-input"
            type="text"
            placeholder={t("Type a custom answer")}
            disabled={answered !== null}
            onChange={(event) => setCustomActive(event.currentTarget.value.trim().length > 0)}
          />
        </>
      ) : (
        <input
          ref={inputRef}
          className="inline-prompt-input"
          type="text"
          placeholder={request.placeholder || ""}
          disabled={answered !== null}
        />
      )}

      {request.method === "select" && customOpen ? (
        <div className="inline-prompt-custom">
          <input
            ref={customInputRef}
            className="inline-prompt-input"
            type="text"
            placeholder={t("Type a custom answer")}
            disabled={answered !== null}
          />
          <div className="inline-prompt-actions">
            <button
              type="button"
              className="inline-prompt-submit"
              disabled={answered !== null}
              onClick={() => {
                onCustomAnswer(customInputRef.current?.value ?? "");
                settle({ value: customSentinel });
              }}
            >
              {t("Submit")}
            </button>
            <button
              type="button"
              className="inline-prompt-cancel"
              disabled={answered !== null}
              onClick={() => {
                setCustomOpen(false);
                flushSync(() => {});
              }}
            >
              {t("Back")}
            </button>
          </div>
        </div>
      ) : answered === null ? (
        <Actions
          onSubmit={
            request.method === "select"
              ? undefined
              : () => {
                  const value =
                    multiOptions.length > 0
                      ? (multiCustomRef.current?.value ?? "").trim() ||
                        Array.from(
                          optionsListRef.current?.querySelectorAll<HTMLInputElement>(
                            "input[type='checkbox']:checked",
                          ) ?? [],
                        )
                          .map((checkbox) => checkbox.value)
                          .sort((a, b) => Number(a) - Number(b))
                          .join(",")
                      : (inputRef.current?.value ?? "");
                  settle({ value });
                }
          }
          onCancel={() => settle({ cancelled: true })}
        />
      ) : null}

      {answered ? (
        <div className="inline-prompt-status">
          {answered.cancelled ? t("Cancelled") : t("Answered")}
        </div>
      ) : null}
    </div>
  );
}

function parseOptionValue(value: unknown): DialogOption {
  return parseOption(value);
}
