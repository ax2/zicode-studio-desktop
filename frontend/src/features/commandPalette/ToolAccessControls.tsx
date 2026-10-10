import { t } from "../../shared/i18n";
import type { PaletteCommand } from "./commandPaletteLogic";
import type { useToolAccess } from "./use-tool-access";

export type AccessView = "all" | "favorites" | "recent";
export function ToolAccessControls({ view, onView, access, selected, unavailable }: {
  view: AccessView;
  onView: (view: AccessView) => void;
  access: ReturnType<typeof useToolAccess>;
  selected?: PaletteCommand;
  unavailable: string[];
}) {
  const busy = access.loading || access.pending;
  const favorite = selected?.id ? access.state.favorites.includes(selected.id) : false;
  return <>
    <fieldset className="command-access-toolbar ui-toolbar" aria-label={t("Tool access")}>
      {(["all", "favorites", "recent"] as const).map(key => <button type="button" key={key}
        className="ui-button ui-button--secondary ui-button--sm" aria-pressed={view === key}
        onClick={() => onView(key)}>{t(key === "all" ? "All commands" : key === "favorites" ? "Favorite commands" : "Recent commands")}</button>)}
      <button type="button" className="ui-icon-button ui-icon-button--sm ui-icon-button--secondary"
        disabled={busy || access.error || !selected?.id} aria-pressed={favorite}
        aria-label={t(favorite ? "Remove selected favorite" : "Favorite selected command")}
        title={t(favorite ? "Remove selected favorite" : "Favorite selected command")}
        onClick={() => { if (selected?.id) void access.mutate({ kind: "favoriteSet", id: selected.id, enabled: !favorite }); }}>
        {favorite ? "★" : "☆"}
      </button>
      {view === "recent" && <button type="button" className="ui-button ui-button--ghost ui-button--sm"
        disabled={busy || !access.state.recent.length} onClick={() => void access.mutate({ kind: "recentClear" })}>{t("Clear recent commands")}</button>}
    </fieldset>
    {access.loading && <p className="command-access-status" role="status">{t("Loading saved commands…")}</p>}
    {access.error && <div className="command-access-status" role="alert">{t("Saved commands unavailable; tools can still run.")}
      <button type="button" className="ui-button ui-button--ghost ui-button--sm" disabled={busy} onClick={access.retry}>{t("Retry")}</button>
    </div>}
    {view === "favorites" && unavailable.length > 0 && <details className="command-access-unavailable">
      <summary>{t("Unavailable favorites ({count})").replace("{count}", String(unavailable.length))}</summary>
      {unavailable.map(id => <div className="command-access-missing" key={id}><span>{id}</span>
        <button type="button" className="ui-button ui-button--ghost ui-button--sm" disabled={busy}
          aria-label={`${t("Remove favorite")}: ${id}`} onClick={() => void access.mutate({ kind: "favoriteSet", id, enabled: false })}>{t("Remove favorite")}</button>
      </div>)}
    </details>}
  </>;
}
