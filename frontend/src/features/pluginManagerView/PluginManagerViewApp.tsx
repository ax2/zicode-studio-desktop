import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { t } from "../../shared/i18n";
import {
  helpPageForPlugin,
  MANAGER_FILTERS,
  matchesFilter,
  type ManagedPlugin,
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
  getTarget,
  notify,
  renderIcon,
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
  getTarget?(): { sceneId?: string } | null;
  notify?(message: string): void;
  renderIcon?(icon: string | undefined): HTMLElement;
  installDeveloperPlugin?: (() => Promise<string | null | undefined>) | null;
  selectSignedPlugin?: (() => Promise<{
    packagePath: string;
    publisher: string;
    publisherKeyId?: string;
    permissions?: string[];
    trusted?: boolean;
  } | null | undefined>) | null;
  installSignedPlugin?: ((
    packagePath: string,
    requireConfirmation: boolean,
  ) => Promise<string | null | undefined>) | null;
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
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const iconRefs = useRef(
    new Map<string, { element: HTMLSpanElement; icon?: string }>(),
  );

  const setBusyKey = (key: string, value: boolean) => {
    setBusy((current) => ({ ...current, [key]: value }));
  };

  const sceneId = getTarget?.()?.sceneId ?? "programming";

  useEffect(() => {
    for (const [, ref] of iconRefs.current) {
      ref.element.replaceChildren();
      if (renderIcon) ref.element.append(renderIcon(ref.icon));
    }
  });

  const plugins = registry.list().filter((plugin) => matchesFilter(plugin, activeFilter));

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
  ) => {
    setBusyKey(key, true);
    try {
      await action();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(key, false);
    }
  };

  const renderCard = (plugin: ManagedPlugin) => {
    const isDeveloperOrSigned =
      plugin.origin === "developer" || plugin.origin === "signed";
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
            iconRefs.current.set(plugin.id, { element, icon: plugin.icon });
          }
          else iconRefs.current.delete(plugin.id);
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
            label={t(
              plugin.core ? "Required" : plugin.enabled ? "Enabled" : "Disabled",
            )}
            variant={plugin.enabled ? "ui-button--secondary" : "ui-button--ghost"}
            disabled={plugin.core}
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
                    `${t("Uninstalled")} ${t(plugin.name)}; ${t(
                      "Plugin data was preserved",
                    )}`,
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
                  disabled={typeof rollbackSignedPlugin !== "function"}
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
              disabled={!plugin.publisherKeyId || typeof revokePublisher !== "function"}
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
                    busy={Boolean(busy[`permission-${plugin.id}-${permission.name}`])}
                    ariaPressed={granted}
                    onClick={() => {
                      void runAction(
                        `permission-${plugin.id}-${permission.name}`,
                        async () => {
                          await registry.setPermission?.(
                            plugin.id,
                            permission.name,
                            !granted,
                          );
                        },
                      );
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
        <p className="plugin-manager-scene">
          {`${t("Scene")}: ${sceneId}`}
        </p>
      </section>
      <div className="plugin-manager-actions">
        <ActionButton
          label={t("Install local plugin")}
          variant="ui-button--primary"
          disabled={typeof installDeveloperPlugin !== "function"}
          title={
            typeof installDeveloperPlugin !== "function"
              ? t("Local plugin installation is available in the desktop application.")
              : undefined
          }
          busy={Boolean(busy["install-local"])}
          onClick={() => {
            void runAction("install-local", async () => {
              const pluginId = await installDeveloperPlugin?.();
              if (!pluginId) return;
              await registry.setScene?.(sceneId);
              notify?.(`${t("Installed")} ${pluginId}`);
            });
          }}
        />
        <ActionButton
          label={t("Install signed package")}
          variant="ui-button--secondary"
          disabled={
            typeof selectSignedPlugin !== "function" ||
            typeof installSignedPlugin !== "function"
          }
          busy={Boolean(busy["install-signed"])}
          onClick={() => {
            void runAction("install-signed", async () => {
              const preview = await selectSignedPlugin?.();
              if (!preview) return;
              const permissionSummary = preview.permissions?.length
                ? preview.permissions.join(", ")
                : t("No permissions requested");
              if (
                !preview.trusted &&
                !(await confirmPublisher?.(
                  `${t("Trust publisher")} ${preview.publisher}?\n${t(
                    "Key fingerprint",
                  )}: ${preview.publisherKeyId}\n${t("Permissions")}: ${permissionSummary}`,
                ))
              ) {
                return;
              }
              const pluginId = await installSignedPlugin?.(
                preview.packagePath,
                !preview.trusted,
              );
              await registry.setScene?.(sceneId);
              notify?.(`${t("Installed")} ${pluginId}`);
            });
          }}
        />
        <ActionButton
          label={t("Refresh")}
          variant="ui-button--secondary"
          busy={Boolean(busy.refresh)}
          onClick={() => {
            void runAction("refresh", async () => {
              await registry.reload?.();
              notify?.(t("Plugin registry refreshed"));
            });
          }}
        />
      </div>
      <div
        className="plugin-manager-filters"
        role="tablist"
        aria-label={t("Plugin filters")}
      >
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
      <div className="plugin-manager-grid">
        {plugins.length === 0 ? (
          <p className="plugin-manager-empty">{t("No plugins in this category.")}</p>
        ) : (
          plugins.map(renderCard)
        )}
      </div>
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
