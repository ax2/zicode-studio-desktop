import { useRef, useState } from "react";
import { t } from "../../shared/i18n";

export interface ToolWorkspace {
  id: string;
  path: string;
}

export interface ToolWorkspaceApi {
  list(): Promise<ToolWorkspace[]>;
  switchTo(path: string): Promise<void>;
  openFolder(): Promise<void>;
}

function displayPath(path: string) { return path.replace(/^\\\\\?\\/, ""); }
function projectName(path: string) { return displayPath(path).split(/[\\/]/).filter(Boolean).at(-1) || path; }

export function ToolWorkspacePicker({ api, currentWorkspaceId }: { api: ToolWorkspaceApi; currentWorkspaceId?: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const requestId = useRef(0);
  const [workspaces, setWorkspaces] = useState<ToolWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const request = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.list();
      if (request === requestId.current && details.current?.open) setWorkspaces((Array.isArray(result) ? result : []).filter(item => item.id && item.path));
    } catch {
      if (request === requestId.current && details.current?.open) setError(t("Projects could not be loaded. Try again."));
    } finally {
      if (request === requestId.current && details.current?.open) setLoading(false);
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      details.current?.removeAttribute("open");
    } catch {
      setError(t("Could not open the project. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const current = workspaces.find(item => item.id === currentWorkspaceId);
  return <details className="tool-workspace-picker" ref={details} onToggle={event => { if (event.currentTarget.open) void refresh(); }}>
    <summary className="ui-button ui-button--secondary" title={current ? displayPath(current.path) : undefined}>
      {t("Switch workspace")}{current ? ` · ${projectName(current.path)}` : ""}
    </summary>
    <div className="tool-workspace-menu ui-panel">
      {loading && <p role="status">{t("Loading…")}</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && <div className="tool-workspace-list">
        {workspaces.map(item => <button type="button" key={item.id} className="ui-button ui-button--ghost"
          disabled={busy || item.id === currentWorkspaceId} aria-current={item.id === currentWorkspaceId ? "true" : undefined}
          title={displayPath(item.path)} onClick={() => void run(() => api.switchTo(item.path))}>
          <strong>{projectName(item.path)}</strong><span>{displayPath(item.path)}</span>
        </button>)}
        {workspaces.length === 0 && !error && <p>{t("No other workspaces yet")}</p>}
      </div>}
      <button type="button" className="ui-button ui-button--secondary" disabled={busy}
        onClick={() => void run(() => api.openFolder())}>{t("Open folder as workspace")}</button>
    </div>
  </details>;
}
