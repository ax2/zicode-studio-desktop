import { useEffect, useMemo, useRef } from "react";
import { t } from "../../shared/i18n";
import { Select } from "../../shared/Select";
import {
  BROWSE_PAGE_SIZE,
  browseSourceFor,
  filterPackages,
  normalizeRepoUrl,
  type BrowsePackage,
  type PackageBrowseStore,
} from "./packageBrowseStore";

const LINK_SVGS: Record<string, string> = {
  npm: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M0 0v24h24v-24h-24zm19.2 19.2h-2.4v-9.6h-4.8v9.6h-7.2v-14.4h14.4v14.4z"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};

export function PackageBrowseTab({ store }: { store: PackageBrowseStore }) {
  const status = store((state) => state.status);
  const error = store((state) => state.error);
  const packages = store((state) => state.packages);
  const installedSet = store((state) => state.installedSet);
  const activeType = store((state) => state.activeType);
  const searchQuery = store((state) => state.searchQuery);
  const installedOnly = store((state) => state.installedOnly);
  const sortMode = store((state) => state.sortMode);
  const page = store((state) => state.page);
  const load = store((state) => state.load);
  const goToPage = store((state) => state.goToPage);

  const results = useMemo(
    () =>
      filterPackages({
        packages,
        installedSet,
        installedOnly,
        activeType,
        searchQuery,
        sortMode,
      }),
    [packages, installedSet, installedOnly, activeType, searchQuery, sortMode],
  );
  const totalPages = Math.max(1, Math.ceil(results.length / BROWSE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * BROWSE_PAGE_SIZE;
  const pageResults = results.slice(start, start + BROWSE_PAGE_SIZE);

  return (
    <div className="settings-body">
      <div className="settings-section">
        <div className="settings-section-title">{t("Browse Community Packages")}</div>
        <p className="settings-help">
          Discover extensions, skills, themes, and prompts from the Pi ecosystem. Install with
          one click.
        </p>
        <div className="pkg-browse-filters">
          <input
            type="text"
            id="pkg-browse-search"
            className="pkg-browse-search"
            placeholder={t("Search packages...")}
            autoComplete="off"
            spellCheck={false}
            value={searchQuery}
            onChange={(event) => store.getState().setSearch(event.target.value)}
          />
          <div className="pkg-browse-pills" id="pkg-browse-pills">
            {["all", "extension", "skill", "theme", "prompt"].map((type) => (
              <button
                key={type}
                type="button"
                className={`pkg-browse-pill${activeType === type ? " active" : ""}`}
                data-pkg-type={type}
                onClick={() => store.getState().setType(type)}
              >
                {type === "all"
                  ? t("All")
                  : type === "extension"
                    ? t("Extensions")
                    : type === "skill"
                      ? t("Skills")
                      : type === "theme"
                        ? t("Themes")
                        : t("Prompts")}
              </button>
            ))}
          </div>
          <label className="pkg-browse-installed-toggle">
            <input
              type="checkbox"
              id="pkg-browse-installed-only"
              checked={installedOnly}
              onChange={(event) =>
                void store.getState().setInstalledOnly(event.target.checked)
              }
            />
            <span>{t("Installed only")}</span>
          </label>
          <Select
            id="pkg-browse-sort"
            className="pkg-browse-sort"
            value={sortMode}
            label={t("Sort packages")}
            options={[
              { value: "downloads", label: t("Most downloads") },
              { value: "name", label: t("Name (A–Z)") },
              { value: "updated", label: t("Recently updated") },
            ]}
            onChange={(value) => store.getState().setSort(value)}
          />
          <span className="pkg-browse-count" id="pkg-browse-count">
            {results.length === 0
              ? `0 of ${results.length}`
              : `${start + 1}–${start + pageResults.length} of ${results.length}`}
          </span>
        </div>
        <div className="settings-extension-list pkg-browse-list" id="pkg-browse-list">
          {status === "loading" ? (
            <div className="settings-api-keys-loading pkg-browse-full-row">
              {t("Loading packages...")}
            </div>
          ) : status === "error" ? (
            <div className="settings-api-keys-empty pkg-browse-full-row">
              {error || t("Failed to load packages")}{" "}
              <button
                type="button"
                className="settings-value-btn"
                id="pkg-browse-retry"
                onClick={() => void load(true)}
              >
                {t("Retry")}
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="settings-api-keys-empty pkg-browse-full-row">
              {t("No packages match your filters.")}
            </div>
          ) : (
            pageResults.map((pkg) => <PackageRow key={pkg.name} store={store} pkg={pkg} />)
          )}
        </div>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onGo={(next) => {
            goToPage(next);
            document.getElementById("pkg-browse-list")?.scrollIntoView({ block: "nearest" });
          }}
        />
      </div>
    </div>
  );
}

function PackageRow({ store, pkg }: { store: PackageBrowseStore; pkg: BrowsePackage }) {
  const installedSet = store((state) => state.installedSet);
  const busySource = store((state) => state.busySource);
  const canManage = store((state) => state.canManage);
  const source = browseSourceFor(pkg);
  const installed = installedSet.has(source);
  const busy = busySource === source;
  const links = pkg.links || {};
  const npmUrl = links.npm || `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`;
  const repo = normalizeRepoUrl(links.repository);
  const homepage = normalizeRepoUrl(links.homepage);

  return (
    <div className="settings-extension-row pkg-browse-row">
      <div className="settings-extension-info">
        <div className="settings-extension-name">{pkg.name}</div>
        {pkg.description ? (
          <div className="settings-extension-description">{pkg.description}</div>
        ) : null}
        <div className="pkg-browse-badges">
          {(pkg.types || []).map((type) => (
            <span key={type} className="pkg-browse-badge" data-type={type}>
              {type}
            </span>
          ))}
          <span className="pkg-browse-meta">{(pkg.downloads || 0).toLocaleString()}/mo</span>
        </div>
        {busy ? (
          <div className="settings-extension-status">
            {installed ? t("Removing…") : t("Installing…")}
          </div>
        ) : null}
        <div className="pkg-browse-links">
          <LinkButton kind="npm" label="npm" url={npmUrl} store={store} />
          {repo ? (
            <LinkButton
              kind={/github\.com/i.test(repo) ? "github" : "link"}
              label={/github\.com/i.test(repo) ? "GitHub" : t("repo")}
              url={repo}
              store={store}
            />
          ) : null}
          {homepage && homepage !== repo ? (
            <LinkButton kind="link" label={t("homepage")} url={homepage} store={store} />
          ) : null}
        </div>
      </div>
      <div className="settings-extension-actions">
        <button
          type="button"
          className="settings-value-btn"
          disabled={busy || !canManage}
          onClick={() => void store.getState().toggleInstall(pkg)}
        >
          {!canManage ? (
            t("Desktop only")
          ) : busy ? (
            <>
              <span className="settings-btn-spinner" aria-hidden="true"></span>
              <span>{installed ? t("Uninstalling…") : t("Installing…")}</span>
            </>
          ) : installed ? (
            t("Uninstall")
          ) : (
            t("Install")
          )}
        </button>
      </div>
    </div>
  );
}

function LinkButton({
  kind,
  label,
  url,
  store,
}: {
  kind: string;
  label: string;
  url: string;
  store: PackageBrowseStore;
}) {
  return (
    <button
      type="button"
      className="pkg-browse-link"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        store.getState().openLink(url);
      }}
    >
      <Icon svg={LINK_SVGS[kind] || LINK_SVGS.link} />
      <span>{label}</span>
    </button>
  );
}

function Icon({ svg }: { svg: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = svg;
  }, [svg]);
  return <span ref={ref} aria-hidden="true" />;
}

function Pagination({
  page,
  totalPages,
  onGo,
}: {
  page: number;
  totalPages: number;
  onGo(next: number): void;
}) {
  if (totalPages <= 1) return null;
  const pages = new Set<number>([1, totalPages, page]);
  for (let d = 1; d <= 2; d += 1) {
    pages.add(page - d);
    pages.add(page + d);
  }
  const visible = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  return (
    <div className="pkg-browse-pagination" id="pkg-browse-pagination">
      <button
        type="button"
        className="pkg-browse-page-btn"
        disabled={page <= 1}
        onClick={() => onGo(page - 1)}
      >
        ‹
      </button>
      {visible.map((p, index) => {
        const prev = visible[index - 1] ?? 0;
        return (
          <span key={p} style={{ display: "inline-flex", alignItems: "center" }}>
            {p - prev > 1 ? (
              <span className="pkg-browse-page-ellipsis">…</span>
            ) : null}
            <button
              type="button"
              className={`pkg-browse-page-btn${p === page ? " is-active" : ""}`}
              disabled={p === page}
              onClick={() => onGo(p)}
            >
              {p}
            </button>
          </span>
        );
      })}
      <button
        type="button"
        className="pkg-browse-page-btn"
        disabled={page >= totalPages}
        onClick={() => onGo(page + 1)}
      >
        ›
      </button>
    </div>
  );
}
