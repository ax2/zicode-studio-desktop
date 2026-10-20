import { useState } from "react";
import { matchesSearchTerms, prepareSearchQuery } from "../../shared/catalog-search";
import { t } from "../../shared/i18n";

export interface SignedPluginPreview {
  packagePath: string;
  manifestSha256: string;
  pluginId: string;
  name: string;
  version: string;
  publisher: string;
  publisherKeyId: string;
  permissions: string[];
  capabilityCount: number;
  capabilities: Array<{ id: string; title: string }>;
  trusted: boolean;
}

export function SignedPluginPreviewCard({
  preview,
  busy,
  onInstall,
  onCancel,
}: {
  preview: SignedPluginPreview;
  busy: boolean;
  onInstall(): void;
  onCancel(): void;
}) {
  const [query, setQuery] = useState("");
  const searchTerms = prepareSearchQuery(query);
  const capabilities = preview.capabilities.filter((capability) =>
    matchesSearchTerms(searchTerms, [capability.id, capability.title, t(capability.title)]),
  );
  return (
    <section className="ui-card plugin-manager-preview" aria-label={t("Review signed package")}>
      <strong>{t("Review signed package")}</strong>
      <p>{`${preview.name} · ${preview.version} · ${preview.publisher}`}</p>
      <p><code>{preview.pluginId}</code></p>
      <p>{`${t("Declared tools")}: ${preview.capabilityCount}`}</p>
      {preview.capabilities.length > 0 ? (
        <details className="plugin-manager-preview-tools">
          <summary>{t("Tool list")}</summary>
          <label htmlFor="signed-plugin-tool-search">{t("Search tools")}</label>
          <input
            id="signed-plugin-tool-search"
            className="ui-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span role="status" aria-live="polite">{`${capabilities.length} / ${preview.capabilities.length}`}</span>
          {capabilities.length ? (
            <ul>
              {capabilities.map((capability) => (
                <li key={capability.id}>
                  <strong>{t(capability.title)}</strong>
                  <code>{capability.id}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("No matching tools")}</p>
          )}
        </details>
      ) : null}
      <p>{`${t("Permissions")}: ${preview.permissions.length ? preview.permissions.join(", ") : t("No permissions requested")}`}</p>
      <p>{`${t("Key fingerprint")}: ${preview.publisherKeyId}`}</p>
      <p>{t(preview.trusted ? "Publisher already trusted" : "Publisher approval required")}</p>
      <div className="plugin-manager-preview-actions">
        <button type="button" className="ui-button ui-button--sm ui-button--primary" disabled={busy} aria-busy={busy} onClick={onInstall}>
          {t("Install reviewed signed package")}
        </button>
        <button type="button" className="ui-button ui-button--sm ui-button--ghost" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </section>
  );
}
