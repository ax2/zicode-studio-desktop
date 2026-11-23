import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../../shared/i18n";
import { blankArticle, homepagePicks, readArticle, writeArticle, type Article } from "./article";
import { messageForError } from "./messages";
import { SyncArticles } from "./SyncArticles";

export type Site = {
  root: string | null;
  paths: string[];
  catalog?: Record<string, { title: string; categories: string[]; tags: string[] }>;
  homepagePicks: boolean;
  changedPaths: string[];
  pendingPush: boolean;
  gitAvailable?: boolean;
};
type Request = {
  action: string;
  site?: string;
  path?: string;
  text?: string;
  expected?: string | null;
  paths?: string[];
  owners?: string[];
  deletions?: string[];
};
export type Invoke = <T>(request: Request) => Promise<T>;
type Edit = {
  path: string;
  original: string | null;
  article: Article;
  categories: string;
  tags: string;
  urlSlug: string;
};

function editor(path: string, original: string | null): Edit {
  const { article, urlSlug } =
    original === null ? { article: blankArticle(), urlSlug: "" } : readArticle(original, path);
  return {
    path,
    article,
    original,
    urlSlug,
    categories: article.category.join(", "),
    tags: article.tags.join(", "),
  };
}
function terms(s: string) {
  return [
    ...new Set(
      s
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}
function matches(path: string, query: string) {
  return path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function Blog({ invoke }: { invoke: Invoke }) {
  const [site, setSite] = useState<Site | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [revision, setRevision] = useState(0);
  const [picks, setPicks] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const run = useCallback(async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setStatus("");
    try {
      await work();
    } catch (error) {
      setStatus(t(messageForError(error)));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  const loadSite = useCallback(
    async (next: Site) => {
      setSite(next);
      setRevision((previous) => previous + 1);
      setPicks(null);
      if (next.root && next.homepagePicks) {
        const raw = await invoke<string>({
          action: "read",
          site: next.root,
          path: "@homepagePicks",
        });
        homepagePicks(raw);
        setPicks(raw);
      }
    },
    [invoke],
  );
  useEffect(() => {
    void run(async () => loadSite(await invoke<Site>({ action: "list" })));
  }, [invoke, run, loadSite]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const discard = () => !dirty || window.confirm(t("Discard unsaved article changes?"));
  function open(path: string | null) {
    if (!site?.root || !discard()) return;
    const root = site.root;
    void run(async () => {
      const text =
        path === null ? null : await invoke<string>({ action: "read", site: root, path });
      setEdit(editor(path ?? "", text));
      setDirty(false);
    });
  }
  function field<K extends keyof Article>(key: K, value: Article[K]) {
    if (edit) {
      setEdit({ ...edit, article: { ...edit.article, [key]: value } });
      setDirty(true);
    }
  }
  async function save() {
    if (!edit || !site?.root) return;
    const article = { ...edit.article, category: terms(edit.categories), tags: terms(edit.tags) };
    if (edit.original === null && !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(article.slug))
      throw new Error("Use a filename-safe slug");
    const path = edit.original === null ? `${article.slug}.md` : edit.path;
    const raw = writeArticle(edit.original, path, article);
    await invoke<string>({
      action: "save",
      site: site.root,
      path,
      text: raw,
      expected: edit.original,
    });
    setEdit(editor(path, raw));
    setDirty(false);
    await loadSite(await invoke<Site>({ action: "list" }));
    setStatus(t("Article saved locally"));
  }
  const paths =
    site?.paths.filter((p) => {
      const info = site.catalog?.[p];
      return (
        !query.trim() ||
        [p, info?.title ?? "", ...(info?.categories ?? []), ...(info?.tags ?? [])].some((x) =>
          matches(x, query),
        )
      );
    }) ?? [];
  const article = edit?.article;
  const root = site?.root ?? "";
  const recommended = !!(picks && edit && homepagePicks(picks).slugs.includes(edit.urlSlug));
  return (
    <section className="blog-workspace" aria-label={t("Blog")}>
      <header>
        <h2>{t("Blog")}</h2>
        <span className="blog-site" title={root}>
          {root.split(/[\\/]/).pop()}
        </span>
        <button
          className="ui-button"
          disabled={busy}
          onClick={() => {
            if (discard())
              void run(async () => {
                const next = await invoke<Site>({ action: "choose" });
                if (next.root !== root) {
                  setEdit(null);
                  setDirty(false);
                }
                await loadSite(next);
              });
          }}
        >
          {t("Choose blog folder")}
        </button>
        {root && site?.gitAvailable && (
          <button
            className="ui-button"
            disabled={busy || dirty}
            onClick={() =>
              void run(async () => {
                const next = await invoke<Site>({ action: "pull", site: root });
                setEdit(null);
                await loadSite(next);
                setStatus(t("Pulled latest articles"));
              })
            }
          >
            {t("Pull changes")}
          </button>
        )}
      </header>
      {status && (
        <p role="status" className="blog-status">
          {status}
        </p>
      )}
      {root && site && (
        <div className="blog-layout">
          <aside>
            <div className="blog-filter">
              <input
                type="search"
                aria-label={t("Find articles, categories or tags")}
                placeholder={t("Find articles, categories or tags")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(100);
                }}
              />
              <button className="ui-button" disabled={busy} onClick={() => open(null)}>
                {t("New article")}
              </button>
            </div>
            <ul className="blog-files">
              {paths.slice(0, limit).map((path) => (
                <li key={path}>
                  <button
                    disabled={busy}
                    aria-current={path === edit?.path ? "page" : undefined}
                    title={path}
                    onClick={() => open(path)}
                  >
                    {site.catalog?.[path]?.title || path}
                  </button>
                </li>
              ))}
            </ul>
            {paths.length > limit && (
              <button className="ui-button" onClick={() => setLimit(limit + 100)}>
                {t("Show more")}
              </button>
            )}
            <SyncArticles
              key={JSON.stringify([root, revision, edit?.path])}
              site={site}
              activeArticle={edit?.original != null ? edit.path : null}
              disabled={busy || dirty}
              invoke={invoke}
              run={run}
              refresh={loadSite}
              onPushed={() => setStatus(t("Changes pushed"))}
            />
          </aside>
          {edit && article && (
            <form
              className="blog-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void run(save);
              }}
            >
              <fieldset disabled={busy}>
                <div className="blog-fields">
                  <label>
                    {t("Title")}
                    <input
                      required
                      value={article.title}
                      onChange={(e) => field("title", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("Article slug")}
                    <input
                      required
                      readOnly={edit.original !== null}
                      value={article.slug}
                      onChange={(e) => field("slug", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("Description")}
                    <input
                      value={article.description}
                      onChange={(e) => field("description", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("Publication date")}
                    <input
                      required
                      value={article.pubDate}
                      onChange={(e) => field("pubDate", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("Categories (comma separated)")}
                    <input
                      value={edit.categories}
                      onChange={(e) => {
                        setEdit({ ...edit, categories: e.target.value });
                        setDirty(true);
                      }}
                    />
                  </label>
                  <label>
                    {t("Tags (comma separated)")}
                    <input
                      value={edit.tags}
                      onChange={(e) => {
                        setEdit({ ...edit, tags: e.target.value });
                        setDirty(true);
                      }}
                    />
                  </label>
                </div>
                <label className="blog-body">
                  {t("Markdown text")}
                  <textarea
                    aria-label={t("Markdown text")}
                    spellCheck={false}
                    value={article.body}
                    onChange={(e) => field("body", e.target.value)}
                  />
                </label>
                <footer>
                  <label>
                    <input
                      type="checkbox"
                      checked={article.draft}
                      onChange={(e) => field("draft", e.target.checked)}
                    />
                    {t("Draft")}
                  </label>
                  <button className="ui-button" type="submit" disabled={!dirty}>
                    {t("Save article")}
                  </button>
                  {picks !== null && edit.original !== null && (
                    <button
                      className="ui-button"
                      type="button"
                      disabled={dirty || (!recommended && article.draft)}
                      onClick={() =>
                        void run(async () => {
                          const next = homepagePicks(picks).toggle(edit.urlSlug);
                          await invoke({
                            action: "save",
                            site: root,
                            path: "@homepagePicks",
                            expected: picks,
                            text: next,
                          });
                          await loadSite(await invoke<Site>({ action: "list" }));
                          setStatus(t("Homepage recommendations updated"));
                        })
                      }
                    >
                      {t(recommended ? "Remove homepage recommendation" : "Feature on homepage")}
                    </button>
                  )}
                </footer>
              </fieldset>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

export function setupBlogApp(invoke: Invoke) {
  let root: Root | null = null;
  let mount: HTMLElement | null = null;
  return {
    renderContent(el: HTMLElement) {
      if (!mount) {
        mount = document.createElement("div");
        mount.className = "plugin-app-mount";
        root = createRoot(mount);
      }
      if (mount.parentNode !== el) el.append(mount);
      root?.render(<Blog invoke={invoke} />);
    },
    handlesCommand(id: string) {
      return id === "blog.open";
    },
    executeCommand() {},
    deactivate() {},
    async refresh() {},
    async setTarget() {},
    destroy() {
      root?.unmount();
      root = null;
      mount?.remove();
      mount = null;
    },
  };
}
