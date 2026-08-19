import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";
import { ArticlesHttpGateway, type ArticlesConfig } from "../articles/articlesStore";

const EMPTY: ArticlesConfig = {
  wechat: {
    appId: "",
    appSecretSet: false,
    siteUrl: "https://zicode.com",
    author: "",
    thumbImagePath: null,
    openComment: false,
    fansCanComment: false,
  },
  blog: {
    host: "",
    username: "",
    passwordSet: false,
    remoteDir: "",
    sourceDir: null,
  },
};

export function ArticlesConfigTab({ getSceneId }: { getSceneId: () => string }) {
  const [config, setConfig] = useState<ArticlesConfig>(EMPTY);
  const [appSecret, setAppSecret] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [disabled, setDisabled] = useState(false);

  const gateway = new ArticlesHttpGateway();

  async function load() {
    setBusy(true);
    setError("");
    try {
      const loaded = await gateway.getConfig({ sceneId: getSceneId(), workspaceId: "" });
      setConfig(loaded);
      setDisabled(false);
    } catch (err) {
      const message = friendlyPluginError(err instanceof Error ? err : new Error(String(err)));
      setError(message);
      setDisabled(/plugin_not_enabled|not enabled|403/i.test(message));
    } finally {
      setBusy(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: config loads once on mount by design.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(resetHostKey = false) {
    setBusy(true);
    setError("");
    try {
      await gateway.saveConfig(
        { sceneId: getSceneId(), workspaceId: "" },
        {
          wechat: {
            appId: config.wechat.appId,
            appSecret,
            siteUrl: config.wechat.siteUrl,
            author: config.wechat.author,
            thumbImagePath: config.wechat.thumbImagePath,
            openComment: config.wechat.openComment,
            fansCanComment: config.wechat.fansCanComment,
          },
          blog: {
            host: config.blog.host,
            username: config.blog.username,
            password,
            remoteDir: config.blog.remoteDir,
            sourceDir: config.blog.sourceDir,
            resetHostKey,
          },
        },
      );
      setAppSecret("");
      setPassword("");
      await load();
    } catch (err) {
      setError(friendlyPluginError(err instanceof Error ? err : new Error(String(err))));
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <div className="articles-config">
        <h2>{t("Article Publishing")}</h2>
        <p className="settings-muted">
          {t("Enable the Articles plugin to configure WeChat and blog publishing.")}
        </p>
      </div>
    );
  }

  const setWechat = (patch: Partial<ArticlesConfig["wechat"]>) =>
    setConfig((current) => ({ ...current, wechat: { ...current.wechat, ...patch } }));
  const setBlog = (patch: Partial<ArticlesConfig["blog"]>) =>
    setConfig((current) => ({ ...current, blog: { ...current.blog, ...patch } }));

  return (
    <div className="articles-config">
      <h2>{t("Article Publishing")}</h2>
      <p className="settings-muted">{t("Publish articles to the Astro blog and WeChat Official Account.")}</p>

      <section className="ui-card">
        <h3>{t("WeChat Official Account")}</h3>
        <label className="settings-field">
          <span>{t("App ID")}</span>
          <input
            className="ui-input"
            value={config.wechat.appId}
            onChange={(event) => setWechat({ appId: event.target.value })}
          />
        </label>
        <label className="settings-field">
          <span>{t("App Secret")}</span>
          <input
            className="ui-input"
            type="password"
            value={appSecret}
            placeholder={config.wechat.appSecretSet ? t("Configured") : ""}
            onChange={(event) => setAppSecret(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>{t("Site URL")}</span>
          <input
            className="ui-input"
            value={config.wechat.siteUrl}
            onChange={(event) => setWechat({ siteUrl: event.target.value })}
          />
        </label>
        <label className="settings-field">
          <span>{t("Author")}</span>
          <input
            className="ui-input"
            value={config.wechat.author}
            onChange={(event) => setWechat({ author: event.target.value })}
          />
        </label>
        <label className="settings-field">
          <span>{t("Default cover image path")}</span>
          <input
            className="ui-input"
            value={config.wechat.thumbImagePath ?? ""}
            onChange={(event) =>
              setWechat({ thumbImagePath: event.target.value || null })
            }
          />
        </label>
        <label className="settings-field settings-row">
          <input
            type="checkbox"
            checked={config.wechat.openComment}
            onChange={(event) => setWechat({ openComment: event.target.checked })}
          />
          <span>{t("Open comments")}</span>
        </label>
      </section>

      <section className="ui-card">
        <h3>{t("Blog server")}</h3>
        <label className="settings-field">
          <span>{t("Host")}</span>
          <input
            className="ui-input"
            value={config.blog.host}
            onChange={(event) => setBlog({ host: event.target.value })}
          />
        </label>
        <label className="settings-field">
          <span>{t("Username")}</span>
          <input
            className="ui-input"
            value={config.blog.username}
            onChange={(event) => setBlog({ username: event.target.value })}
          />
        </label>
        <label className="settings-field">
          <span>{t("Password")}</span>
          <input
            className="ui-input"
            type="password"
            value={password}
            placeholder={config.blog.passwordSet ? t("Configured") : ""}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>{t("Remote directory")}</span>
          <input
            className="ui-input"
            value={config.blog.remoteDir}
            placeholder="/work/zicode-astro"
            onChange={(event) => setBlog({ remoteDir: event.target.value })}
          />
        </label>
        <label className="settings-field">
          <span>{t("Astro source directory")}</span>
          <input
            className="ui-input"
            value={config.blog.sourceDir ?? ""}
            placeholder="/home/alex/work/www.zicode.com"
            onChange={(event) => setBlog({ sourceDir: event.target.value || null })}
          />
        </label>
      </section>

      {error ? (
        <p className="articles-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="ui-button ui-button--primary"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void save()}
      >
        {t("Save")}
      </button>
      <button
        type="button"
        className="ui-button ui-button--ghost"
        disabled={busy || !config.blog.host}
        onClick={() => void save(true)}
      >
        {t("Reset host key")}
      </button>
    </div>
  );
}
