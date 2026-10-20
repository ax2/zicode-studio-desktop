import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import type { PluginTaskCursor, PluginTaskDetail, PluginTaskPage } from "./store";

const STATE_LABELS: Record<string, string> = {
  queued: "Plugin task queued",
  running: "Plugin task running",
  awaiting_confirmation: "Plugin task awaiting confirmation",
  succeeded: "Plugin task succeeded",
  partial: "Plugin task partially completed",
  declined: "Plugin task declined",
  failed: "Plugin task failed",
  cancelled: "Plugin task cancelled",
  revoked: "Plugin task permission revoked",
  interrupted: "Plugin task interrupted",
};

export function PluginTaskOverview({
  workspaceId,
  list,
  detail,
}: {
  workspaceId: string | null;
  list: (workspaceId: string, before?: PluginTaskCursor) => Promise<PluginTaskPage>;
  detail?: (workspaceId: string, taskRef: string, beforeSequence?: number) => Promise<PluginTaskDetail>;
}) {
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const [tasks, setTasks] = useState<PluginTaskPage["tasks"]>([]);
  const [cursor, setCursor] = useState<PluginTaskCursor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PluginTaskDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [earlierBusy, setEarlierBusy] = useState(false);
  const [earlierError, setEarlierError] = useState(false);

  const openDetail = useCallback(async (taskRef: string) => {
    if (!workspaceId || !detail) return;
    if (selectedRef === taskRef) {
      detailGeneration.current += 1;
      setSelectedRef(null);
      setSelectedDetail(null);
      setDetailBusy(false);
      setEarlierBusy(false);
      return;
    }
    const request = ++detailGeneration.current;
    setSelectedRef(taskRef);
    setSelectedDetail(null);
    setDetailBusy(true);
    setDetailError(false);
    setEarlierError(false);
    try {
      const result = await detail(workspaceId, taskRef);
      if (request === detailGeneration.current) setSelectedDetail(result);
    } catch {
      if (request === detailGeneration.current) setDetailError(true);
    } finally {
      if (request === detailGeneration.current) setDetailBusy(false);
    }
  }, [detail, selectedRef, workspaceId]);

  const loadEarlier = useCallback(async () => {
    if (!workspaceId || !detail || !selectedRef || !selectedDetail?.earlierEventsAvailable || earlierBusy) return;
    const firstSequence = selectedDetail.events[0]?.sequence;
    if (!firstSequence) return;
    const request = detailGeneration.current;
    setEarlierBusy(true);
    setEarlierError(false);
    try {
      const page = await detail(workspaceId, selectedRef, firstSequence);
      if (request !== detailGeneration.current || page.snapshot.taskRef !== selectedRef) return;
      setSelectedDetail((previous) => previous?.snapshot.taskRef === selectedRef ? {
        ...previous,
        events: [...page.events, ...previous.events],
        earlierEventsAvailable: page.earlierEventsAvailable,
      } : previous);
    } catch {
      if (request === detailGeneration.current) setEarlierError(true);
    } finally {
      if (request === detailGeneration.current) setEarlierBusy(false);
    }
  }, [detail, earlierBusy, selectedDetail, selectedRef, workspaceId]);

  const load = useCallback(
    async (before?: PluginTaskCursor) => {
      if (!workspaceId) return;
      const request = ++generation.current;
      setBusy(true);
      setError(null);
      try {
        const page = await list(workspaceId, before);
        if (request !== generation.current) return;
        setTasks((previous) => (before ? [...previous, ...page.tasks] : page.tasks));
        setCursor(page.nextCursor);
      } catch {
        if (request === generation.current) setError(t("Could not load plugin tasks"));
      } finally {
        if (request === generation.current) setBusy(false);
      }
    },
    [list, workspaceId],
  );

  useEffect(() => {
    setTasks([]);
    setCursor(null);
    detailGeneration.current += 1;
    setSelectedRef(null);
    setSelectedDetail(null);
    setDetailBusy(false);
    setDetailError(false);
    setEarlierBusy(false);
    setEarlierError(false);
    if (workspaceId) void load();
    return () => {
      generation.current += 1;
      detailGeneration.current += 1;
    };
  }, [load, workspaceId]);

  if (!workspaceId) return null;
  return (
    <section className="ui-panel" aria-label={t("Plugin tasks")}>
      <div className="ui-toolbar">
        <h2>{t("Plugin tasks")}</h2>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={busy}
          onClick={() => void load()}
        >
          {t("Refresh")}
        </button>
      </div>
      <p>{t("Plugin tool runs for this workspace. Task history is read-only here.")}</p>
      {error ? <p role="alert">{error}</p> : null}
      {busy && tasks.length === 0 ? <p role="status">{t("Loading plugin tasks…")}</p> : null}
      {!busy && !error && tasks.length === 0 ? (
        <p>{t("No plugin tasks in this workspace")}</p>
      ) : null}
      {tasks.length > 0 ? (
        <ul className="task-center-list">
          {tasks.map((task) => (
            <li className="ui-card" key={task.taskRef}>
              <strong>{task.operationId}</strong>
              <span>
                {" "}
                · {task.pluginId} · {task.packageVersion}
              </span>
              <p>
                {t(STATE_LABELS[task.state] ?? "Plugin task state unavailable")} ·{" "}
                {new Date(task.updatedAtMs).toLocaleString()}
              </p>
              {detail ? (
                <button type="button" className="ui-button ui-button--secondary ui-button--sm"
                  aria-expanded={selectedRef === task.taskRef}
                  onClick={() => void openDetail(task.taskRef)}>
                  {t(selectedRef === task.taskRef ? "Hide plugin task details" : "Show plugin task details")}
                </button>
              ) : null}
              {selectedRef === task.taskRef ? (
                <section className="ui-panel" aria-label={t("Plugin task details")}>
                  {detailBusy ? <p role="status">{t("Loading plugin task details…")}</p> : null}
                  {detailError ? <p role="alert">{t("Could not load plugin task details")}</p> : null}
                  {earlierError ? <p role="alert">{t("Could not load earlier plugin task events")}</p> : null}
                  {selectedDetail ? (
                    <>
                      {selectedDetail.snapshot.cancelRequested ? (
                        <p>{t("Plugin task cancellation requested")}</p>
                      ) : null}
                      {selectedDetail.earlierEventsAvailable ? (
                        <button type="button" className="ui-button ui-button--secondary ui-button--sm"
                          disabled={earlierBusy} onClick={() => void loadEarlier()}>
                          {t(earlierBusy ? "Loading earlier plugin task events…" : "Load earlier plugin task events")}
                        </button>
                      ) : null}
                      <ol className="plugin-task-event-list" start={selectedDetail.events[0]?.sequence ?? 1}>
                        {selectedDetail.events.map((event) => (
                          <li key={event.sequence}>
                            {t(STATE_LABELS[event.state] ?? "Plugin task state unavailable")}
                            {" · "}{new Date(event.atMs).toLocaleString()}
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : null}
                </section>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {cursor ? (
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={busy}
          onClick={() => void load(cursor)}
        >
          {t("Load more")}
        </button>
      ) : null}
    </section>
  );
}
