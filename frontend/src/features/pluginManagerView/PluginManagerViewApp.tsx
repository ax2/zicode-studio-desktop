import { useState } from "react";
import { flushSync } from "react-dom";
import { matchesSearchTerms, prepareSearchQuery } from "../../shared/catalog-search";
import { t } from "../../shared/i18n";
import { PluginCatalog } from "./PluginCatalog";
import { SignedPluginPreviewCard, type SignedPluginPreview } from "./SignedPluginPreviewCard";
import {
  friendlyPluginError,
  helpPageForPlugin,
  MANAGER_FILTERS,
  type ManagedPlugin,
  matchesFilter,
  type PluginManagerFilter,
} from "./pluginManagerLogic";

export interface PluginManagerRegistry {
  list(): ManagedPlugin[];
  diagnostics?(): Array<{ package: string; message: string }>;
  setEnabled?(id: string, enabled: boolean): Promise<unknown>;
  setPermission?(id: string, name: string, granted: boolean): Promise<unknown>;
  setScene?(sceneId: string): Promise<unknown>;
  reload?(): Promise<unknown>;
  uninstall?(id: string): Promise<unknown>;
}

export interface DeveloperPluginPreview {
  sourcePath: string;
  contentSha256: string;
  pluginId: string;
  name: string;
  version: string;
  publisher: string;
  permissions: string[];
  capabilityCount: number;
}

function ActionButton({
  label,
  variant = "ui-button--ghost",
  disabled,
  title,
  busy,
  onClick,
  ariaPressed,
  ...rest
}: {
  label: string;
  variant?: string;
  disabled?: boolean;
  title?: string;
  busy?: boolean;
  onClick?(): void;
  ariaPressed?: boolean | "false" | "mixed" | "true";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`ui-button ui-button--sm ${variant}`}
      disabled={disabled || busy}
      title={title}
      onClick={onClick}
      aria-pressed={ariaPressed}
      {...rest}
    >
      {label}
    </button>
  );
}

export function PluginManagerViewApp({
  registry,
  canManagePlugins = true,
  getTarget,
  notify,
  renderIcon,
  selectDeveloperPlugin,
  installDeveloperPlugin,
  selectSignedPlugin,
  installSignedPlugin,
  rollbackSignedPlugin,
  revokePublisher,
  initialFilter = "installed",
  onFilterChange,
  confirmUninstall,
  confirmPublisher,
  openHelp,
}: {
  registry: PluginManagerRegistry;
  canManagePlugins?: boolean;
  getTarget?(): { sceneId?: string } | null;
  notify?(message: string): void;
  renderIcon?(icon: string | undefined): HTMLElement;
  selectDeveloperPlugin?: (() => Promise<DeveloperPluginPreview | null | undefined>) | null;
  installDeveloperPlugin?: ((sourcePath: string, contentSha256: string) => Promise<string | null | undefined>) | null;
  selectSignedPlugin?: (() => Promise<SignedPluginPreview | null | undefined>) | null;
  installSignedPlugin?:
    | ((packagePath: string, manifestSha256: string, requireConfirmation: boolean) => Promise<string | null | undefined>)
    | null;
  rollbackSignedPlugin?: ((id: string, version: string) => Promise<unknown>) | null;
  revokePublisher?: ((publisherKeyId: string) => Promise<unknown>) | null;
  initialFilter?: PluginManagerFilter;
  onFilterChange?(filter: PluginManagerFilter): void;
  confirmUninstall?(message: string): boolean | Promise<boolean>;
  confirmPublisher?(message: string): boolean | Promise<boolean>;
  /** Open the Help center page that explains this plugin (when available). */
  openHelp?(pageId: string): void;
}) {
  const [activeFilter, setActiveFilter] = useState<PluginManagerFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [developerPreview, setDeveloperPreview] = useState<DeveloperPluginPreview | null>(null);
  const [signedPreview, setSignedPreview] = useState<SignedPluginPreview | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const setBusyKey = (key: string, value: boolean) => {
    setBusy((current) => ({ ...current, [key]: value }));
  };

  const sceneId = getTarget?.()?.sceneId ?? "programming";

  const categoryPlugins = registry.list().filter((plugin) => matchesFilter(plugin, activeFilter));
  const searchTerms = prepareSearchQuery(query);
  const plugins = categoryPlugins.filter((plugin) =>
    matchesSearchTerms(searchTerms, [
      plugin.id,
      plugin.name,
      t(plugin.name),
      plugin.description,
      t(plugin.description),
      plugin.publisher,
      plugin.version,
      ...(plugin.capabilities ?? []).flatMap((capability) => [
        capability.id,
        capability.title,
        capability.title ? t(capability.title) : undefined,
        capability.description,
        capability.description ? t(capability.description) : undefined,
      ]),
    ]),
  );

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setBusyKey(key, true);
    try {
      await action();
    } catch (error) {
      notify?.(friendlyPluginError(error));
    } finally {
      setBusyKey(key, false);
    }
  };

  const renderCard = (plugin: ManagedPlugin) => {
    const isDeveloperOrSigned = plugin.origin === "developer" || plugin.origin === "signed";
    const helpPage = helpPageForPlugin(plugin.id);
    const permissions = [
      ...(plugin.permissionDetails?.required ?? []),
      ...(plugin.permissionDetails?.optional ?? []),
    ];
    return (
      <article className="ui-card plugin-manager-card" key={plugin.id}>
        <span
          className="plugin-manager-icon"
          ref={(element) => {
            if (element) {
              element.replaceChildren();
              if (renderIcon) element.append(renderIcon(plugin.icon));
            }
          }}
        />
        <div className="plugin-manager-copy">
          <strong>{t(plugin.name)}</strong>
          <span className="ui-badge plugin-manager-origin">
            {t(
              plugin.origin === "developer"
                ? "Developer"
                : plugin.origin === "signed"
                  ? "Signed"
                  : "Built-in",
            )}
          </span>
          {plugin.version && (
            <span className="ui-badge" data-plugin-version={plugin.version}>
              v{plugin.version}
            </span>
          )}
          <code>{plugin.id}</code>
          <p>{t(plugin.description)}</p>
        </div>
        <div className="plugin-manager-card-actions">
          {helpPage && openHelp ? (
            <ActionButton
              label={t("Usage guide")}
              variant="ui-button--ghost"
              onClick={() => openHelp(helpPage)}
            />
          ) : null}
          <ActionButton
            label={t(plugin.core ? "Required" : plugin.enabled ? "Enabled" : "Disabled")}
            variant={plugin.enabled ? "ui-button--secondary" : "ui-button--ghost"}
            disabled={plugin.core || !canManagePlugins}
            busy={Boolean(busy[`toggle-${plugin.id}`])}
            ariaPressed={Boolean(plugin.enabled)}
            onClick={() => {
              void runAction(`toggle-${plugin.id}`, async () => {
                await registry.setEnabled?.(plugin.id, !plugin.enabled);
              });
            }}
          />
          {isDeveloperOrSigned ? (
            <ActionButton
              label={t("Uninstall")}
              variant="ui-button--danger"
              disabled={!canManagePlugins}
              busy={Boolean(busy[`uninstall-${plugin.id}`])}
              onClick={async () => {
                if (
                  !(await confirmUninstall?.(
                    `${t("Uninstall")} ${t(plugin.name)}? ${t(
                      "Plugin data will be preserved for a future reinstall.",
                    )}`,
                  ))
                ) {
                  return;
                }
                void runAction(`uninstall-${plugin.id}`, async () => {
                  await registry.uninstall?.(plugin.id);
                  notify?.(
                    `${t("Uninstalled")} ${t(plugin.name)}; ${t("Plugin data was preserved")}`,
                  );
                });
              }}
            />
          ) : null}
          {plugin.origin === "signed"
            ? (plugin.retainedVersions ?? []).map((version) => (
                <ActionButton
                  label={`${t("Rollback")} ${version}`}
                  variant="ui-button--ghost"
                  disabled={!canManagePlugins || typeof rollbackSignedPlugin !== "function"}
                  busy={Boolean(busy[`rollback-${plugin.id}-${version}`])}
                  key={version}
                  onClick={async () => {
                    if (
                      !(await confirmPublisher?.(
                        `${t("Rollback")} ${t(plugin.name)} → ${version}?`,
                      ))
                    ) {
                      return;
                    }
                    void runAction(`rollback-${plugin.id}-${version}`, async () => {
                      await rollbackSignedPlugin?.(plugin.id, version);
                      await registry.setScene?.(sceneId);
                      notify?.(`${t("Rolled back")} ${t(plugin.name)} → ${version}`);
                    });
                  }}
                />
              ))
            : null}
          {plugin.origin === "signed" ? (
            <ActionButton
              label={t("Revoke publisher")}
              variant="ui-button--danger"
              disabled={
                !canManagePlugins || !plugin.publisherKeyId || typeof revokePublisher !== "function"
              }
              busy={Boolean(busy[`revoke-${plugin.id}`])}
              onClick={async () => {
                if (
                  !(await confirmPublisher?.(
                    `${t("Revoke publisher")} ${plugin.publisher}?\n${t(
                      "Key fingerprint",
                    )}: ${plugin.publisherKeyId}`,
                  ))
                ) {
                  return;
                }
                void runAction(`revoke-${plugin.id}`, async () => {
                  await revokePublisher?.(plugin.publisherKeyId as string);
                  await registry.setScene?.(sceneId);
                  notify?.(`${t("Publisher revoked")}: ${plugin.publisher}`);
                });
              }}
            />
          ) : null}
        </div>
        {permissions.length > 0 ? (
          <div className="plugin-manager-permissions">
            <strong>{t("Scene permissions")}</strong>
            {permissions.map((permission) => {
              const granted = plugin.permissions?.[permission.name] === true;
              return (
                <div className="plugin-manager-permission" key={permission.name}>
                  <span title={t(permission.reason ?? "")}>{permission.name}</span>
                  <ActionButton
                    label={t(granted ? "Allowed" : "Denied")}
                    variant="ui-button--ghost"
                    disabled={!canManagePlugins}
                    busy={Boolean(busy[`permission-${plugin.id}-${permission.name}`])}
                    ariaPressed={granted}
                    onClick={() => {
                      void runAction(`permission-${plugin.id}-${permission.name}`, async () => {
                        await registry.setPermission?.(plugin.id, permission.name, !granted);
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </article>
    );
  };

  const diagnostics = registry.diagnostics?.() ?? [];

  return (
    <>
      <section className="plugin-main-hero">
        <span className="plugin-main-kicker">{t("Application extensions")}</span>
        <h1>{t("Plugin Manager")}</h1>
        <p>
          {t(
            "Manage application plugins independently from Pi extensions. State and permissions are scoped to the current scene.",
          )}
        </p>
        <p className="plugin-manager-scene">{`${t("Scene")}: ${sceneId}`}</p>
        {!canManagePlugins ? (
          <p>{t("Plugin management is available in the desktop app.")}</p>
        ) : null}
      </section>
      <div className="plugin-manager-actions">
        <ActionButton
          label={t("Install local plugin")}
          variant="ui-button--primary"
          disabled={!canManagePlugins || typeof selectDeveloperPlugin !== "function" || typeof installDeveloperPlugin !== "function"}
          title={
            typeof selectDeveloperPlugin !== "function" || typeof installDeveloperPlugin !== "function"
              ? t("Local plugin installation is available in the desktop application.")
              : undefined
          }
          busy={Boolean(busy["preview-local"])}
          onClick={() => {
            setDeveloperPreview(null);
            setSignedPreview(null);
            void runAction("preview-local", async () => {
              const preview = await selectDeveloperPlugin?.();
              if (preview) setDeveloperPreview(preview);
            });
          }}
        />
        <ActionButton
          label={t("Install signed package")}
          variant="ui-button--secondary"
          disabled={
            !canManagePlugins ||
            typeof selectSignedPlugin !== "function" ||
            typeof installSignedPlugin !== "function"
          }
          busy={Boolean(busy["preview-signed"])}
          onClick={() => {
            setDeveloperPreview(null);
            setSignedPreview(null);
            void runAction("preview-signed", async () => {
              const preview = await selectSignedPlugin?.();
              if (preview) setSignedPreview(preview);
            });
          }}
        />
        <ActionButton
          label={t("Refresh")}
          variant="ui-button--secondary"
          disabled={!canManagePlugins}
          busy={Boolean(busy.refresh)}
          onClick={() => {
            void runAction("refresh", async () => {
              await registry.reload?.();
              notify?.(t("Plugin registry refreshed"));
            });
          }}
        />
      </div>
      {developerPreview ? (
        <section className="ui-card plugin-manager-preview" aria-label={t("Review local plugin")}>
          <strong>{t("Review local plugin")}</strong>
          <p>{`${developerPreview.name} · ${developerPreview.version} · ${developerPreview.publisher}`}</p>
          <p><code>{developerPreview.pluginId}</code></p>
          <p>{`${t("Declared tools")}: ${developerPreview.capabilityCount}`}</p>
          <p>{`${t("Permissions")}: ${developerPreview.permissions.length ? developerPreview.permissions.join(", ") : t("No permissions requested")}`}</p>
          <p>{t("Unsigned development package. It will be disabled until you enable it and grant permissions.")}</p>
          <div className="plugin-manager-preview-actions">
            <ActionButton
              label={t("Install reviewed plugin")}
              variant="ui-button--primary"
              busy={Boolean(busy["install-local"])}
              onClick={() => {
                void runAction("install-local", async () => {
                  const pluginId = await installDeveloperPlugin?.(developerPreview.sourcePath, developerPreview.contentSha256);
                  if (!pluginId) return;
                  setDeveloperPreview(null);
                  await registry.setScene?.(sceneId);
                  notify?.(`${t("Installed")} ${pluginId}`);
                });
              }}
            />
            <ActionButton label={t("Cancel")} disabled={Boolean(busy["install-local"])} onClick={() => setDeveloperPreview(null)} />
          </div>
        </section>
      ) : null}
      {signedPreview ? (
        <SignedPluginPreviewCard
          preview={signedPreview}
          busy={Boolean(busy["install-signed"])}
          onCancel={() => setSignedPreview(null)}
          onInstall={() => {
            void runAction("install-signed", async () => {
              const permissionSummary = signedPreview.permissions.length
                ? signedPreview.permissions.join(", ")
                : t("No permissions requested");
              if (
                !signedPreview.trusted &&
                !(await confirmPublisher?.(
                  `${t("Trust publisher")} ${signedPreview.publisher}?\n${t(
                    "Key fingerprint",
                  )}: ${signedPreview.publisherKeyId}\n${t("Permissions")}: ${permissionSummary}`,
                ))
              ) {
                return;
              }
              const pluginId = await installSignedPlugin?.(signedPreview.packagePath, signedPreview.manifestSha256, !signedPreview.trusted);
              if (!pluginId) return;
              setSignedPreview(null);
              await registry.setScene?.(sceneId);
              notify?.(`${t("Installed")} ${pluginId}`);
            });
          }}
        />
      ) : null}
      <div className="plugin-manager-filters" role="tablist" aria-label={t("Plugin filters")}>
        {MANAGER_FILTERS.map((filter) => (
          <button
            type="button"
            className="ui-button ui-button--sm ui-button--ghost"
            role="tab"
            aria-selected={filter.id === activeFilter}
            data-plugin-filter={filter.id}
            key={filter.id}
            onClick={() => {
              setActiveFilter(filter.id);
              flushSync(() => {});
              onFilterChange?.(filter.id);
            }}
          >
            {t(filter.label)}
          </button>
        ))}
      </div>
      <div className="plugin-manager-search">
        <label htmlFor="plugin-manager-search">{t("Search plugins and tools")}</label>
        <input
          id="plugin-manager-search"
          className="ui-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search names, capabilities or publishers")}
        />
        <span className="plugin-manager-search-count" role="status" aria-live="polite">
          {`${plugins.length} / ${categoryPlugins.length}`}
        </span>
      </div>
      <PluginCatalog key={`${activeFilter}:${query}`} plugins={plugins} renderCard={renderCard} empty={(
          <p className="plugin-manager-empty">
            {t(
              searchTerms.length ? "No matching plugins or tools." : "No plugins in this category.",
            )}
          </p>
        )} />
      {diagnostics.length > 0 ? (
        <section className="ui-card plugin-manager-diagnostics">
          <strong>{t("Rejected developer packages")}</strong>
          {diagnostics.map((diagnostic) => (
            <p key={`${diagnostic.package}-${diagnostic.message}`}>
              {`${diagnostic.package}: ${diagnostic.message}`}
            </p>
          ))}
        </section>
      ) : null}
    </>
  );
}
