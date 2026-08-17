import { useRef } from "react";
import { t } from "../../shared/i18n";
import {
  defaultTitle,
  parseOption,
  type DialogPreview,
} from "./dialogLogic";

export interface NativeDialogStore {
  method: string;
  header: string;
  title: string;
  body: string;
  previews: DialogPreview[];
  options: unknown[];
  prefill: string;
  placeholder: string;
}

export function NativeDialogApp({
  store,
  onFinish,
  onInputRef,
}: {
  store: NativeDialogStore;
  onFinish(result: Record<string, unknown>): void;
  onInputRef(input: HTMLInputElement | HTMLTextAreaElement | null): void;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const setInputRef = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    inputRef.current = element;
    onInputRef(element);
  };
  const titleText = store.title || defaultTitle(store.method);
  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog-title">
        {store.header ? (
          <span className="dialog-header-badge">{store.header}</span>
        ) : null}
        <span>{titleText}</span>
      </div>
      {store.method === "select" ? (
        <>
          {store.body ? <div className="dialog-message">{store.body}</div> : null}
          <div
            className={
              store.previews.length > 0
                ? "dialog-body dialog-body--with-preview"
                : "dialog-body"
            }
          >
            <div className="dialog-options">
              {store.options.map((value) => {
                const option = parseOption(value);
                return (
                  <button
                    type="button"
                    className="dialog-option"
                    key={String(value)}
                    onClick={() => onFinish({ value })}
                  >
                    {option.number ? (
                      <span className="dialog-option-index">{option.number}</span>
                    ) : null}
                    <span className="dialog-option-label">{option.label}</span>
                    {option.description ? (
                      <span className="dialog-option-description">{option.description}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {store.previews.length > 0 ? (
              <div className="dialog-preview-panel">
                {store.previews.map((preview) => (
                  <section
                    className="dialog-preview"
                    key={`${preview.number}-${preview.label}`}
                  >
                    <div className="dialog-preview-title">
                      {preview.number}. {preview.label}
                    </div>
                    <pre className="dialog-preview-body">{preview.content}</pre>
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : store.method === "confirm" ? (
        <div className="dialog-message">{store.body || ""}</div>
      ) : (
        <>
          {store.body ? <div className="dialog-message">{store.body}</div> : null}
          {store.method === "editor" ? (
            <textarea
              ref={setInputRef}
              className="dialog-textarea"
              defaultValue={store.prefill}
              placeholder={store.placeholder}
              aria-label={store.placeholder || titleText}
            />
          ) : (
            <input
              ref={setInputRef}
              className="dialog-input"
              defaultValue={store.prefill}
              placeholder={store.placeholder}
              aria-label={store.placeholder || titleText}
            />
          )}
        </>
      )}
      <div className="dialog-actions">
        {store.method === "confirm" ? (
          <>
            <button type="button" onClick={() => onFinish({ confirmed: false })}>
              {t("No")}
            </button>
            <button type="button" onClick={() => onFinish({ confirmed: true })}>
              {t("Yes")}
            </button>
          </>
        ) : store.method !== "select" ? (
          <button
            type="button"
            onClick={() => {
              const value = inputRef.current?.value ?? "";
              onFinish({ value });
            }}
          >
            {store.method === "editor" ? t("Save") : t("Submit")}
          </button>
        ) : null}
        <button type="button" onClick={() => onFinish({ cancelled: true })}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
