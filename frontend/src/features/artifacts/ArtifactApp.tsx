import { useEffect, useState, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n.js";
// @ts-expect-error plain JS module without type declarations
import { renderMarkdown } from "../../../../public/ui/markdown.js";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  kindLabel,
  markdownContent,
  pluginLabel,
  stringifyContent,
  type ArtifactDescriptor,
  type ArtifactDocument,
} from "./logic";
import { createArtifactStore, type ArtifactAppOptions } from "./store";

type ArtifactStore = ReturnType<typeof createArtifactStore>;

export function ArtifactNav({ store }: { store: ArtifactStore }) {
  const snapshot = store((state) => state.snapshot);
  const selected = store((state) => state.selected);
  const loading = store((state) => state.loading);
  const kind = store((state) => state.kind);
  const pluginId = store((state) => state.pluginId);
  const setKind = store((state) => state.setKind);
  const setPluginId = store((state) => state.setPluginId);
  const load = store((state) => state.load);
  const selectArtifact = store((state) => state.selectArtifact);
  const exportAll = store((state) => state.exportAll);
  const importAll = store((state) => state.importAll);
  const [search, setSearch] = useState(store.getState().query);

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = store.getState();
      if (current.query !== search.trim()) {
        current.setQuery(search.trim());
        void current.load({ preserveSelection: false });
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [search, store]);

  return (
    <div className="artifacts-navigation">
      <label className="artifacts-search-field">
        <span className="artifacts-search-label">{t("Search artifacts")}</span>
        <input
          className="artifacts-search"
          type="search"
          value={search}
          placeholder={t("Search artifacts")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="ui-button ui-button--secondary ui-button--sm artifacts-export-all"
        onClick={() => void exportAll()}
      >
        {t("Export all artifacts")}
      </button>
      <button
        type="button"
        className="ui-button ui-button--secondary ui-button--sm artifacts-import-all"
        onClick={() => void importAll()}
      >
        {t("Import all artifacts")}
      </button>
      <FilterSection
        title={t("Types")}
        options={[
          { label: t("All"), value: "", active: !kind },
          ...snapshot.kinds.map((value) => ({
            label: t(kindLabel(value)),
            value,
            active: kind === value,
          })),
        ]}
        onSelect={(value) => {
          setKind(value);
          void load({ preserveSelection: false });
        }}
      />
      {snapshot.plugins.length > 0 ? (
        <FilterSection
          title={t("Source plugins")}
          options={[
            { label: t("All"), value: "", active: !pluginId },
            ...snapshot.plugins.map((value) => ({
              label: pluginLabel(value),
              value,
              active: pluginId === value,
            })),
          ]}
          onSelect={(value) => {
            setPluginId(value);
            void load({ preserveSelection: false });
          }}
        />
      ) : null}
      <section className="artifacts-nav-section">
        <h2>{t("Recent")}</h2>
        {loading && snapshot.artifacts.length === 0 ? (
          <p className="artifacts-nav-message">{t("Loading artifacts…")}</p>
        ) : snapshot.artifacts.length === 0 ? (
          <p className="artifacts-nav-message">{t("No artifacts found")}</p>
        ) : (
          snapshot.artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className={`artifacts-list-item${selected?.id === artifact.id ? " active" : ""}`}
              aria-pressed={selected?.id === artifact.id}
              onClick={() => void selectArtifact(artifact)}
            >
              <strong>{artifact.title}</strong>
              <span>
                {t(kindLabel(artifact.kind))} · {formatDate(artifact.createdAt)}
              </span>
            </button>
          ))
        )}
      </section>
    </div>
  );
}

function FilterSection({
  title,
  options,
  onSelect,
}: {
  title: string;
  options: Array<{ label: string; value: string; active: boolean }>;
  onSelect(value: string): void;
}) {
  return (
    <section className="artifacts-nav-section">
      <h2>{title}</h2>
      {options.map((option) => (
        <button
          key={option.value || option.label}
          type="button"
          className={`artifacts-filter${option.active ? " active" : ""}`}
          aria-pressed={option.active}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </section>
  );
}

export function ArtifactMain({ store }: { store: ArtifactStore }) {
  const selected = store((state) => state.selected);
  const loading = store((state) => state.loading);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  const deleteSelected = store((state) => state.deleteSelected);
  const exportSelected = store((state) => state.exportSelected);

  return (
    <div className="artifacts-main">
      {error ? (
        <StatePanel title={t("Could not load artifacts")} description={error.message}>
          <button type="button" className="ui-button ui-button--primary" onClick={() => void load()}>
            {t("Retry")}
          </button>
        </StatePanel>
      ) : loading && !selected ? (
        <StatePanel title={t("Loading artifacts…")} description="" />
      ) : !selected ? (
        <StatePanel
          title={t("Artifacts")}
          description={t(
            "Reports, datasets, and files created by plugins appear here with their provenance.",
          )}
        />
      ) : (
        <ArtifactDocumentView
          selected={selected}
          exportSelected={exportSelected}
          deleteSelected={deleteSelected}
        />
      )}
    </div>
  );
}

function ArtifactDocumentView({
  selected,
  exportSelected,
  deleteSelected,
}: {
  selected: ArtifactDocument;
  exportSelected: () => boolean;
  deleteSelected: () => Promise<void>;
}) {
  const markdown = markdownContent(selected);
  return (
    <article className="artifacts-document">
      <header className="artifacts-document-header">
        <div>
          <span className="artifacts-document-kicker">
            {t(kindLabel(selected.kind))} · {pluginLabel(selected.pluginId)}
          </span>
          <h1>{selected.title}</h1>
          {selected.summary ? <p>{selected.summary}</p> : null}
        </div>
        <div className="artifacts-document-actions">
          <button type="button" className="ui-button ui-button--secondary" onClick={exportSelected}>
            {t("Export")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--danger"
            onClick={() => void deleteSelected()}
          >
            {t("Delete")}
          </button>
        </div>
      </header>
      <dl className="artifacts-metadata">
        <Metadata term={t("Created")} value={formatDateTime(selected.createdAt)} />
        <Metadata term={t("Format")} value={selected.mimeType} />
        <Metadata term={t("Size")} value={formatBytes(selected.size)} />
        <Metadata term={t("Resource handle")} value={selected.handle} />
      </dl>
      <section className="artifacts-content">
        <h2>{t("Content")}</h2>
        {markdown !== null ? (
          <div
            className="artifacts-markdown markdown-body"
            ref={(node) => {
              if (node) node.innerHTML = renderMarkdown(markdown);
            }}
          />
        ) : (
          <pre className="artifacts-json">{stringifyContent(selected.content)}</pre>
        )}
      </section>
      <section className="artifacts-provenance">
        <h2>{t("Provenance")}</h2>
        <pre className="artifacts-json">{stringifyContent(selected.provenance)}</pre>
      </section>
    </article>
  );
}

function Metadata({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}

function StatePanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="artifacts-state-panel">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  );
}

export interface ArtifactAppApi {
  deleteSelected(): Promise<void>;
  exportSelected(): boolean;
  exportAll(): Promise<void>;
  load(options?: { preserveSelection?: boolean }): Promise<void>;
  renderContent(container: HTMLElement): void;
  renderNavigation(container: HTMLElement): void;
  selectArtifact(descriptor: ArtifactDescriptor): Promise<void>;
  openArtifact(artifactId: string): Promise<void>;
  setTarget(): void;
  destroy(): void;
}

export function createArtifactApp(options: ArtifactAppOptions): ArtifactAppApi {
  const store = createArtifactStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    deleteSelected() {
      return store.getState().deleteSelected();
    },
    exportSelected() {
      return store.getState().exportSelected();
    },
    exportAll() {
      return store.getState().exportAll();
    },
    load(options) {
      return store.getState().load(options);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(
        container,
        <ArtifactMain store={store} />,
        contentRoot,
      );
    },
    renderNavigation(container) {
      navRoot = mountPluginSurface(
        container,
        <ArtifactNav store={store} />,
        navRoot,
      );
    },
    selectArtifact(descriptor) {
      return store.getState().selectArtifact(descriptor);
    },
    openArtifact(artifactId) {
      return store.getState().openArtifact(artifactId);
    },
    setTarget() {
      store.getState().setTarget();
    },
    destroy() {
      store.getState().destroy();
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
  };
}

export type { ArtifactDocument };
