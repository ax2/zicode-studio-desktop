import { useRef } from "react";
import type { Root } from "react-dom/client";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
import { t } from "../../shared/i18n";
import { ModelToolPicker } from "../../shared/ModelToolPicker";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { Select } from "../../shared/Select";
import { TARGET_LANGUAGES } from "./translationLogic";
import {
  createTranslationStore,
  type TranslationOptions,
  type TranslationStore,
} from "./translationStore";

export type TranslationAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
};

function TranslationNav() {
  return <nav className="translate-nav" aria-label={t("Translate")} />;
}

export function TranslationMain({ store }: { store: TranslationStore }) {
  const modelSelection = store((state) => state.modelSelection);
  const text = store((state) => state.text);
  const sourceLang = store((state) => state.sourceLang);
  const targetLang = store((state) => state.targetLang);
  const result = store((state) => state.result);
  const editedText = store((state) => state.editedText);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <div className="translate-main">
      <header className="translate-header">
        <h1>{t("Translation")}</h1>
        <p>
          {t(
            "Translate text between languages using the configured model. Copy the result or download it.",
          )}
        </p>
      </header>

      <FirstRunGuide
        storageKey="translate"
        title={t("Translate text in seconds")}
        steps={[
          t("Paste or type the text to translate."),
          t("Pick the target language."),
          t("Translate, then copy or download the result."),
        ]}
        ctaLabel={t("Start translating")}
        onCta={() => inputRef.current?.focus()}
      />

      <section className="ui-card translate-source">
        <ModelToolPicker sceneId={store.getState().getSceneId()} value={modelSelection} onChange={store.getState().setModelSelection} load={store.getState().loadModels} disabled={busy} />
        <textarea
          ref={inputRef}
          className="translate-textarea"
          value={text}
          placeholder={t("Source text")}
          aria-label={t("Source text")}
          rows={6}
          onChange={(event) => store.getState().setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              if (!busy && text.trim()) void store.getState().run();
            }
          }}
        />
        <div className="translate-controls">
          <div className="settings-field">
            <span>{t("Source language")}</span>
            <Select
              id="translate-source-language"
              value={sourceLang}
              label={t("Source language")}
              options={[
                { value: "", label: t("Auto-detect") },
                ...TARGET_LANGUAGES.map((language) => ({
                  value: language,
                  label: t(language),
                })),
              ]}
              onChange={(value) => store.getState().setSourceLang(value)}
            />
          </div>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm translate-swap"
            aria-label={t("Swap languages")}
            onClick={() => store.getState().swap()}
          >
            ⇄
          </button>
          <div className="settings-field">
            <span>{t("Target language")}</span>
            <Select
              id="translate-target-language"
              value={targetLang}
              label={t("Target language")}
              options={TARGET_LANGUAGES.map((language) => ({
                value: language,
                label: t(language),
              }))}
              onChange={(value) => store.getState().setTargetLang(value)}
            />
          </div>
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--sm"
            disabled={busy || !text.trim()}
            aria-busy={busy}
            onClick={() => void store.getState().run()}
          >
            {busy ? t("Translating…") : t("Translate")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            disabled={busy || (!text.trim() && !result)}
            onClick={() => store.getState().clear()}
          >
            {t("Clear")}
          </button>
        </div>
        {error ? (
          <p className="idphoto-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="ui-card translate-result">
        <div className="translate-result-header">
          <h2>{t("Result")}</h2>
          {result ? (
            <div className="translate-result-actions">
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => store.getState().download()}
              >
                {t("Download")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => void store.getState().copyResult()}
              >
                {t("Copy")}
              </button>
            </div>
          ) : null}
        </div>
        {result ? (
          <>
            <textarea
              className="translate-result-text"
              value={editedText}
              aria-label={t("Result")}
              onChange={(event) => store.getState().setEditedText(event.target.value)}
            />
            <p className="translate-result-meta">
              {result.sourceLang
                ? `${result.sourceLang} → ${result.targetLang}`
                : `${t("Auto-detect")} → ${result.targetLang}`}
              {" · "}
              {result.provider ? `${result.provider} / ` : ""}{result.model} · {editedText.length} {t("characters")}
            </p>
          </>
        ) : (
          <p className="idphoto-result-empty">{t("Enter text to translate.")}</p>
        )}
      </section>
    </div>
  );
}

export function createTranslationApp(options: TranslationOptions): TranslationAppApi {
  const store = createTranslationStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <TranslationNav />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <TranslationMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "translate.open";
    },
    executeCommand() {},
    refresh() {
      return Promise.resolve();
    },
  };
}
