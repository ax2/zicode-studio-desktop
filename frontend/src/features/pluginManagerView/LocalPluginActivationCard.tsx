import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { DirectoryItem, ToolPage } from "../toolCenter/manual-tools";
import type { ManagedPlugin } from "./pluginManagerLogic";

export interface InstalledToolActions {
  list(pluginId: string, packageRevision: string): Promise<ToolPage>;
  open(pluginId: string, packageRevision: string, tool: DirectoryItem, revision: string): Promise<boolean>;
  openDirectory(): Promise<unknown>;
}

function PermissionName({ name }: { name: string }) {
  const names: Record<string, string> = {
    "resource.read": "Read selected resources",
    "resource.result.save": "Save tool results",
    "pi.tools.register": "Make tools available to Pi",
  };
  return <>{names[name] ? <>{t(names[name])} <code>{name}</code></> : <code>{name}</code>}</>;
}

export function LocalPluginActivationCard({
  plugin, deferred, busy, installedTools, onClose, onDefer, onResume, onActivate, onError,
}: {
  plugin: ManagedPlugin;
  deferred: boolean;
  busy: boolean;
  installedTools?: InstalledToolActions;
  onClose(): void;
  onDefer(): void;
  onResume(): void;
  onActivate?(grants: string[]): void;
  onError(error: unknown): void;
}) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => { card.current?.focus(); }, []);
  const [chosen, setChosen] = useState<string[]>([]);
  const [tools, setTools] = useState<ToolPage | null>(null);
  const [toolListFailed, setToolListFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const packageRevision = plugin.activationReview?.packageRevision;
  const required = plugin.permissionDetails?.required ?? [];
  const optional = plugin.permissionDetails?.optional ?? [];
  const granted = (name: string) => plugin.permissions?.[name] === true;
  const missingRequired = required.filter(({ name }) => !granted(name));
  const pending = missingRequired.length > 0;

  useEffect(() => {
    if (!plugin.enabled || !packageRevision || !installedTools) return;
    let active = true;
    void installedTools.list(plugin.id, packageRevision).then(
      (page) => { if (active) setTools(page); },
      () => { if (active) setToolListFailed(true); },
    );
    return () => { active = false; };
  }, [installedTools, plugin.enabled, plugin.id, packageRevision]);

  const open = async (action: () => Promise<unknown>) => {
    setOpening(true);
    try {
      await action();
    } catch (error) {
      onError(error);
    } finally {
      setOpening(false);
    }
  };

  return (
    <section ref={card} tabIndex={-1} className="ui-card plugin-manager-preview" aria-label={t("Installed plugin setup")}>
      <header className="plugin-manager-preview-actions">
        <strong>{t(plugin.name)}</strong>
        <span role="status" className="ui-badge">{t(plugin.enabled ? "Available" : pending ? "Permission required" : "Disabled")}</span>
      </header>
      {plugin.enabled ? (
        <>
          {installedTools && !tools && !toolListFailed ? <p role="status">{t("Finding available tools…")}</p> : null}
          {toolListFailed ? <p role="status">{t("Could not load this plugin’s tools. Open Tool Center to try again.")}</p> : null}
          {tools && tools.items.length > 0 && installedTools && packageRevision ? (
            <ul className="plugin-onboarding-tools">
              {tools.items.map((tool) => (
                <li key={tool.toolId}>
                  <button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={opening}
                    onClick={() => void open(async () => {
                      if (!(await installedTools.open(plugin.id, packageRevision, tool, tools.revision))) {
                        throw new Error(t("Could not open this tool. Try again."));
                      }
                    })}>{t("Open {tool}").replace("{tool}", t(tool.title))}</button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : deferred ? (
        <p>{t("You can review permissions and enable this plugin later in Plugin Manager.")}</p>
      ) : (
        <>
          {plugin.capabilities?.length ? (
            <p>{t("Declared tools")} · {plugin.capabilities.map((capability) => t(capability.title ?? capability.id ?? "")).join(", ")}</p>
          ) : null}
          <fieldset className="plugin-onboarding-permissions" disabled={busy || !onActivate}>
            <legend>{t("Permissions")}</legend>
            {[...required.map((permission) => ({ ...permission, required: true })),
              ...optional.map((permission) => ({ ...permission, required: false }))].map((permission) => (
                <label key={permission.name}>
                  <input type="checkbox" checked={granted(permission.name) || chosen.includes(permission.name)}
                    disabled={granted(permission.name)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setChosen((current) => checked ? [...current, permission.name] : current.filter((name) => name !== permission.name));
                    }}
                  />
                  <span>
                    <PermissionName name={permission.name} /> · {t(permission.required ? "Required" : "Optional")}
                    {granted(permission.name) ? <> · {t("Allowed")}</> : null}
                    {permission.reason ? <small>{t(permission.reason)}</small> : null}
                  </span>
                </label>
              ))}
            {required.length + optional.length === 0 ? <p>{t("No permissions requested")}</p> : null}
          </fieldset>
          {pending ? <p>{t("Select the required permissions to enable this plugin.")}</p> : null}
        </>
      )}
      <div className="plugin-manager-preview-actions">
        {plugin.enabled ? (
          <>
            {installedTools ? <button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={opening}
              onClick={() => void open(installedTools.openDirectory)}>{t("Open Tool Center")}</button> : null}
            <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={onClose}>{t("Close")}</button>
          </>
        ) : deferred ? (
          <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onResume}>{t("Review and enable")}</button>
        ) : (
          <>
            <button type="button" className="ui-button ui-button--primary ui-button--sm" aria-busy={busy}
              disabled={busy || !onActivate || missingRequired.some(({ name }) => !chosen.includes(name))}
              onClick={() => onActivate?.(chosen)}>
              {t(chosen.length ? "Authorize and enable" : "Enable plugin")}
            </button>
            <button type="button" className="ui-button ui-button--ghost ui-button--sm" disabled={busy}
              onClick={() => { setChosen([]); onDefer(); }}>{t("Keep disabled")}</button>
          </>
        )}
      </div>
    </section>
  );
}
