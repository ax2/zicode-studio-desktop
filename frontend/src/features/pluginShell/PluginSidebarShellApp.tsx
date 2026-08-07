import { useState } from "react";
import { t } from "../../shared/i18n";
import { PluginIcon } from "./PluginActivityBarApp";

export interface PluginAccordionItem {
  label: string;
  action?(): void;
}

export interface PluginAccordion {
  title: string;
  description?: string;
  items?: PluginAccordionItem[];
  action?: string;
  expanded?: boolean;
}

function Accordion({ accordion }: { accordion: PluginAccordion }) {
  const [expanded, setExpanded] = useState(accordion.expanded === true);
  return (
    <section className="plugin-sidebar-view">
      <button
        type="button"
        className="plugin-sidebar-view-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <PluginIcon name="chevron" />
        <span>{accordion.title}</span>
      </button>
      <div className="plugin-sidebar-view-body" hidden={!expanded}>
        {accordion.description ? (
          <p className="plugin-sidebar-empty">{accordion.description}</p>
        ) : null}
        {accordion.items?.length ? (
          <ul className="plugin-sidebar-items">
            {accordion.items.map((item) => (
              <li key={item.label}>
                <button type="button" onClick={item.action}>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {accordion.action ? (
          <button
            type="button"
            className="ui-button ui-button--sm ui-button--ghost plugin-sidebar-action"
          >
            {accordion.action}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function PluginSidebarShell({
  title,
  accordions,
}: {
  title: string;
  accordions: PluginAccordion[];
}) {
  return (
    <>
      <div className="plugin-sidebar-title">{title}</div>
      {accordions.map((accordion) => (
        <Accordion accordion={accordion} key={accordion.title} />
      ))}
    </>
  );
}

export function pluginOverviewCards(pluginId: string, target: { sceneId?: string; sceneName?: string } | null) {
  if (pluginId === "com.zicode.notes") {
    return [
      [t("Local Markdown"), t("Readable files remain the source of truth.")],
      [t("Web capture"), t("URL content becomes sourced Markdown without saving credentials.")],
      [t("Astro vault"), t("Content Collections prepare local publishing and future clients.")],
    ];
  }
  if (pluginId === "com.zicode.finance") {
    return [
      [t("Current scene"), target?.sceneName || target?.sceneId || t("Unknown")],
      [t("Deterministic engine"), t("Existing screening, backtests, and ledgers are preserved.")],
      [t("Workbench"), t("The current Finance Workbench remains available.")],
    ];
  }
  return [
    [t("Unified library"), t("Reports, charts, files, and source metadata in one place.")],
    [t("Resource handles"), t("Large artifacts stay outside conversation payloads.")],
    [t("Exports"), t("Plugins contribute exports through audited commands.")],
  ];
}

export function pluginPreviewStatusText(pluginId: string, target: { sceneId?: string } | null) {
  return pluginId === "com.zicode.finance" && target?.sceneId !== "finance"
    ? t("Open a Finance scene to use the existing workbench.")
    : t("This area is ready for plugin data and actions.");
}

export function PluginMainShell({
  plugin,
  target,
  previewStatus,
  onOpenWorkbench,
  onOpenConfiguration,
}: {
  plugin: { id: string; name: string; description: string; origin: string };
  target: { sceneId?: string; sceneName?: string } | null;
  previewStatus: string;
  onOpenWorkbench(): void;
  onOpenConfiguration(): void;
}) {
  const cards = pluginOverviewCards(plugin.id, target);
  return (
    <>
      <section className="plugin-main-hero">
        <span className="plugin-main-kicker">
          {t(plugin.origin === "developer" ? "Developer plugin" : "Built-in plugin")}
        </span>
        <h1>{t(plugin.name)}</h1>
        <p>{t(plugin.description)}</p>
      </section>
      <div>
        <div className="plugin-overview-grid">
          {cards.map(([title, description]) => (
            <article className="ui-card plugin-overview-card" key={title}>
              <strong>{title}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>
        {plugin.id === "com.zicode.finance" ? (
          <div className="plugin-main-actions">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={target?.sceneId !== "finance"}
              onClick={onOpenWorkbench}
            >
              {t("Open existing Finance Workbench")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--secondary"
              onClick={onOpenConfiguration}
            >
              {t("Open configuration")}
            </button>
          </div>
        ) : null}
        <p
          className="plugin-preview-status"
          data-plugin-preview-status
          aria-live="polite"
        >
          {previewStatus}
        </p>
      </div>
    </>
  );
}
