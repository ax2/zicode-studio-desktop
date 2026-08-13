import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
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

function TranslationMain({ store }: { store: TranslationStore }) {
  const text = store((state) => state.text);
  const sourceLang = store((state) => state.sourceLang);
  const targetLang = store((state) => state.targetLang);
  const result = store((state) => state.result);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);

  return (
    <div className="translate-main">
      <header className="translate-header">
        <h1>{t("Translation")}</h1>
        <p>{t("Translate text between languages using the configured model.")}</p>
      </header>

      <section className="ui-card translate-source">
        <textarea
          className="translate-textarea"
          value={text}
          placeholder={t("Source text")}
          rows={6}
          onChange={(event) => store.getState().setText(event.target.value)}
        />
        <div className="translate-controls">
          <label className="settings-field">
            <span>{t("Source language")}</span>
            <select
              value={sourceLang}
              onChange={(event) => store.getState().setSourceLang(event.target.value)}
            >
              <option value="">{t("Auto-detect")}</option>
              {TARGET_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(language)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm translate-swap"
            aria-label={t("Swap languages")}
            onClick={() => store.getState().swap()}
          >
            ⇄
          </button>
          <label className="settings-field">
            <span>{t("Target language")}</span>
            <select
              value={targetLang}
              onChange={(event) => store.getState().setTargetLang(event.target.value)}
            >
              {TARGET_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(language)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--sm"
            disabled={busy || !text.trim()}
            aria-busy={busy}
            onClick={() => void store.getState().run()}
          >
            {busy ? t("Translating…") : t("Translate")}
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
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={() => void navigator.clipboard?.writeText(result.translated)}
            >
              {t("Copy")}
            </button>
          ) : null}
        </div>
        {result ? (
          <>
            <p className="translate-result-text">{result.translated}</p>
            <p className="translate-result-meta">
              {result.model} · {result.targetLang} · {result.charCount} {t("characters")}
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
