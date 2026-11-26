import { t } from "../../shared/i18n";

export type DefaultHomepage = {
  path: string;
  status: "found" | "missing" | "unavailable";
};

export function SiteDetails({
  homepage,
  recommendations,
}: {
  homepage: DefaultHomepage;
  recommendations: boolean;
}) {
  return (
    <details className="blog-site-details">
      <summary>{t("Site details")}</summary>
      <dl>
        <dt>{t("Default static homepage")}</dt>
        <dd>
          <code translate="no">{homepage.path}</code>
          <span>
            {homepage.status === "found"
              ? t("Output found. It may come from an earlier build.")
              : homepage.status === "missing"
                ? t("Default output missing. Custom builds may use another directory.")
                : t("Could not verify the default output.")}
          </span>
        </dd>
        <dt>{t("Homepage recommendations")}</dt>
        <dd>{recommendations ? t("Available") : t("Unavailable")}</dd>
        <dt>{t("Site preview and publishing")}</dt>
        <dd>{t("Use your site's build and publishing tools.")}</dd>
      </dl>
    </details>
  );
}
