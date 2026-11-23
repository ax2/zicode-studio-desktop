import { useState } from "react";
import { t } from "../../shared/i18n";
import type { Invoke, Site } from "./index";

type Review = { paths: string[]; deletions: string[]; sizes?: Record<string, number> };
type Props = {
  site: Site;
  activeArticle: string | null;
  disabled: boolean;
  invoke: Invoke;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: (site: Site) => Promise<void>;
  onPushed: () => void;
};

function filename(key: string, collection = "src/content/blog") {
  if (key === "@homepagePicks") return "src/lib/homepagePicks.ts";
  if (key.startsWith("@asset/")) return key.slice(7);
  return `${collection}/${key}`;
}

export function SyncArticles({
  site,
  activeArticle,
  disabled,
  invoke,
  run,
  refresh,
  onPushed,
}: Props) {
  const [owners, setOwners] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [deletions, setDeletions] = useState<string[]>([]);
  const choices = [...new Set([...site.changedPaths, ...(activeArticle ? [activeArticle] : [])])];
  const root = site.root ?? "";
  if (!root || !site.gitAvailable || (!choices.length && !site.pendingPush)) return null;

  function select(owner: string, enabled: boolean) {
    setOwners(enabled ? [...owners, owner] : owners.filter((x) => x !== owner));
    setReview(null);
    setDeletions([]);
  }
  async function preview() {
    setReview(null);
    setDeletions([]);
    setReview(await invoke<Review>({ action: "preview", site: root, paths: owners }));
  }
  async function push() {
    try {
      await refresh(
        await invoke<Site>({
          action: "push",
          site: root,
          owners: site.pendingPush ? [] : owners,
          paths: site.pendingPush ? [] : (review?.paths ?? []),
          deletions: site.pendingPush ? [] : deletions,
        }),
      );
      onPushed();
    } catch (error) {
      await refresh(await invoke<Site>({ action: "list" }));
      throw error;
    }
  }
  return (
    <details className="blog-sync">
      <summary>{t("Sync articles to GitHub")}</summary>
      <fieldset disabled={disabled}>
        {site.pendingPush ? (
          <button className="ui-button" onClick={() => void run(push)}>
            {t("Retry push")}
          </button>
        ) : (
          <>
            {choices.map((owner) => (
              <label key={owner}>
                <input
                  type="checkbox"
                  checked={owners.includes(owner)}
                  onChange={(e) => select(owner, e.target.checked)}
                />
                {owner === "@homepagePicks" ? filename(owner, site.collection) : owner}
              </label>
            ))}
            <button
              className="ui-button"
              disabled={!owners.length}
              onClick={() => void run(preview)}
            >
              {t("Review files to sync")}
            </button>
            {review && (
              <section aria-label={t("Files to sync")}>
                <ul>
                  {review.paths.map((key) => (
                    <li key={key}>
                      {review.deletions.includes(key) ? (
                        <label>
                          <input
                            type="checkbox"
                            checked={deletions.includes(key)}
                            onChange={(e) =>
                              setDeletions(
                                e.target.checked
                                  ? [...deletions, key]
                                  : deletions.filter((k) => k !== key),
                              )
                            }
                          />
                          {t("Confirm deletion")} · {filename(key, site.collection)}
                        </label>
                      ) : (
                        <>
                          {filename(key, site.collection)}
                          {review.sizes?.[key] !== undefined && (
                            <small> · {Math.ceil(review.sizes[key] / 1024)} KiB</small>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {!review.paths.length && <p>{t("No changes to sync for these articles")}</p>}
                <button
                  className="ui-button"
                  disabled={
                    !review.paths.length || review.deletions.some((k) => !deletions.includes(k))
                  }
                  onClick={() => void run(push)}
                >
                  {t("Commit and push selected changes")}
                </button>
              </section>
            )}
          </>
        )}
      </fieldset>
    </details>
  );
}
