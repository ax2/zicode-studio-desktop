import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  plugin, focusOnMount = true, deferred, busy, installedTools, onClose, onDefer, onResume, onActivate, onError,
}: {
  plugin: ManagedPlugin;
  focusOnMount?: boolean;
  deferred: boolean;
  busy: boolean;
  installedTools?: InstalledToolActions;
  onClose(origin?: HTMLButtonElement): void;
  onDefer(): void;
  onResume(): void;
  onActivate?(grants: string[], setupCard: HTMLElement | null): void;
  onError(error: unknown): void;
}) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => { if (focusOnMount) card.current?.focus(); }, [focusOnMount]);
  const focusAfterAction = useRef<"defer" | "resume" | "activate" | { retryScope: string } | null>(null);
  const reviewAction = useRef<HTMLButtonElement>(null);
  const requiredPermission = useRef<HTMLInputElement>(null);
  const activateAction = useRef<HTMLButtonElement>(null);
  const availableAction = useRef<HTMLButtonElement>(null);
  const retryAction = useRef<HTMLButtonElement>(null);
  const firstToolAction = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<{ revision?: string; grants: string[] }>();
  const reviewRevision = plugin.activationReview?.sceneRevision;
  const chosen = selection?.revision === reviewRevision ? selection?.grants ?? [] : [];
  const packageRevision = plugin.activationReview?.packageRevision;
  const toolScope = plugin.enabled && packageRevision && installedTools
    ? JSON.stringify([plugin.id, packageRevision, reviewRevision])
    : null;
  const [toolAttempt, setToolAttempt] = useState(0);
  const [toolList, setToolList] = useState<{
    scope: string; attempt: number; actions: InstalledToolActions; page: ToolPage | null;
    catalogChanged?: true;
  }>();
  const tools = toolList && toolList.scope === toolScope && toolList.attempt === toolAttempt && toolList.actions === installedTools
    ? toolList.page
    : undefined;
  const toolListFailed = tools === null;
  const [opening, setOpening] = useState(false);
  const required = plugin.permissionDetails?.required ?? [];
  const optional = plugin.permissionDetails?.optional ?? [];
  const granted = (name: string) => plugin.permissions?.[name] === true;
  const missingRequired = required.filter(({ name }) => !granted(name));
  const pending = missingRequired.length > 0;

  function keepFocusInCard(origin: HTMLButtonElement, action: NonNullable<typeof focusAfterAction.current>) {
    const root = card.current;
    if (root?.ownerDocument.activeElement !== origin) return;
    focusAfterAction.current = action;
    // Keep a stable focus target while React replaces or disables the action button.
    root.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    const action = focusAfterAction.current;
    if (!action) return;
    const root = card.current;
    if (!root || root.ownerDocument.activeElement !== root) {
      focusAfterAction.current = null;
      return;
    }
    if (typeof action !== "string") {
      if (action.retryScope !== toolScope) {
        focusAfterAction.current = null;
        return;
      }
      if (tools === undefined) return;
      const next = toolListFailed ? retryAction.current : firstToolAction.current ?? availableAction.current;
      focusAfterAction.current = null;
      next?.focus({ preventScroll: true });
      return;
    }
    if (busy || (action === "defer" && !deferred) || (action === "resume" && deferred)) return;
    const permissionAction = activateAction.current?.disabled ? requiredPermission.current : activateAction.current;
    const next = action === "defer" ? reviewAction.current : plugin.enabled ? availableAction.current : permissionAction;
    focusAfterAction.current = null;
    next?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!toolScope || !packageRevision || !installedTools) return;
    let active = true;
    const settle = (page: ToolPage | null) => {
      if (active) setToolList({ scope: toolScope, attempt: toolAttempt, actions: installedTools, page });
    };
    void installedTools.list(plugin.id, packageRevision).then(settle, () => settle(null));
    return () => { active = false; };
  }, [installedTools, plugin.id, packageRevision, toolAttempt, toolScope]);

  const open = async (action: () => Promise<unknown>, page?: ToolPage) => {
    // Keep the opening buttons focusable while preventing duplicate navigation.
    if (opening) return;
    setOpening(true);
    try {
      await action();
    } catch (error) {
      if (page && error && typeof error === "object" && "code" in error && error.code === "catalog_changed") {
        setToolList(current => current?.page === page && current.scope === toolScope &&
          current.attempt === toolAttempt && current.actions === installedTools
          ? { ...current, page: null, catalogChanged: true }
          : current);
      } else {
        onError(error);
      }
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
          {toolScope && tools === undefined ? <p role="status">{t("Finding available tools…")}</p> : null}
          {toolScope && toolListFailed ? (
            <div className="plugin-manager-preview-actions">
              <p role="status">{t(toolList?.catalogChanged
                ? "Tool changed. Reload its details before retrying."
                : "Could not load this plugin’s tools.")}</p>
              <button ref={retryAction} type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={opening}
                onClick={(event) => {
                  keepFocusInCard(event.currentTarget, { retryScope: toolScope });
                  setToolAttempt((attempt) => attempt + 1);
                }}>{t("Try again")}</button>
            </div>
          ) : null}
          {tools && tools.items.length > 0 && installedTools && packageRevision ? (
            <ul className="plugin-onboarding-tools">
              {tools.items.map((tool, index) => (
                <li key={tool.toolId}>
                  <button ref={index === 0 ? firstToolAction : undefined} type="button" className="ui-button ui-button--secondary ui-button--sm" aria-disabled={opening || undefined}
                    onClick={() => void open(async () => {
                      if (!(await installedTools.open(plugin.id, packageRevision, tool, tools.revision))) {
                        throw new Error(t("Could not open this tool. Try again."));
                      }
                    }, tools)}>{t("Open {tool}").replace("{tool}", t(tool.title))}</button>
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
                  <input type="checkbox" ref={permission.name === missingRequired[0]?.name ? requiredPermission : undefined}
                    checked={granted(permission.name) || chosen.includes(permission.name)}
                    disabled={granted(permission.name)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelection({
                        revision: reviewRevision,
                        grants: checked ? [...chosen, permission.name] : chosen.filter((name) => name !== permission.name),
                      });
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
            {installedTools ? <button ref={availableAction} type="button" className="ui-button ui-button--secondary ui-button--sm" aria-disabled={opening || undefined}
              onClick={() => void open(installedTools.openDirectory)}>{t("Open Tool Center")}</button> : null}
            <button ref={!installedTools ? availableAction : undefined} type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={() => onClose()}>{t("Close")}</button>
          </>
        ) : deferred ? (
          <>
            <button ref={reviewAction} type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={(event) => {
              keepFocusInCard(event.currentTarget, "resume");
              onResume();
            }}>{t("Review and enable")}</button>
            <button type="button" className="ui-button ui-button--ghost ui-button--sm"
              onClick={(event) => onClose(event.currentTarget)}>{t("Close")}</button>
          </>
        ) : (
          <>
            <button ref={activateAction} type="button" className="ui-button ui-button--primary ui-button--sm" aria-busy={busy}
              disabled={busy || !onActivate || missingRequired.some(({ name }) => !chosen.includes(name))}
              onClick={(event) => {
                keepFocusInCard(event.currentTarget, "activate");
                onActivate?.(chosen, card.current);
              }}>
              {t(chosen.length ? "Authorize and enable" : "Enable plugin")}
            </button>
            <button type="button" className="ui-button ui-button--ghost ui-button--sm" disabled={busy}
              onClick={(event) => {
                keepFocusInCard(event.currentTarget, "defer");
                setSelection(undefined);
                onDefer();
              }}>{t("Keep disabled")}</button>
          </>
        )}
      </div>
    </section>
  );
}
