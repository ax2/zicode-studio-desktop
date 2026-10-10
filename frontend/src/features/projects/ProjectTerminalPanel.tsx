import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import type { ProjectRunnerApi } from "./project-runner";
import {
  loadTerminalEngine,
  type TerminalApi,
  type TerminalInfo,
  terminalError,
  terminalStatus,
} from "./project-terminal";
import { TerminalDirectoryPicker } from "./TerminalDirectoryPicker";
import { TerminalStartupDetails } from "./TerminalStartupDetails";
import { connectTerminal } from "./terminal-connection";
import { useTerminalSessions } from "./use-terminal-sessions";

function TerminalSurface({
  api,
  workspace,
  info,
  onInfo,
}: {
  api: TerminalApi;
  workspace: string;
  info: TerminalInfo;
  onInfo: (info: TerminalInfo) => void;
}) {
  const element = useRef<HTMLFieldSetElement>(null);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [revision, setRevision] = useState(0);
  const replayThrough = useRef(info.outputEnd);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reconnect explicitly replaces the emulator.
  useEffect(() => {
    let disposed = false;
    let engine:
      | Awaited<ReturnType<Awaited<ReturnType<typeof loadTerminalEngine>>["createTerminal"]>>
      | undefined;
    let connection: ReturnType<typeof connectTerminal> | undefined;
    setError("");
    setTruncated(false);
    void (async () => {
      try {
        const module = await loadTerminalEngine();
        if (disposed || !element.current) return;
        let initialSize: [number, number] | undefined;
        engine = await module.createTerminal(element.current, {
          onData: (bytes) => connection?.input(bytes),
          onResize: (cols, rows) => {
            initialSize = [cols, rows];
            connection?.resize(cols, rows);
          },
        });
        if (disposed) {
          engine.dispose();
          return;
        }
        connection = connectTerminal(
          api,
          workspace,
          info.id,
          engine,
          {
            state: onInfo,
            error: (reason) => setError(terminalError(reason)),
            truncated: () => setTruncated(true),
          },
          replayThrough.current,
        );
        if (initialSize) connection.resize(...initialSize);
      } catch (reason) {
        if (!disposed) setError(terminalError(reason));
      }
    })();
    return () => {
      disposed = true;
      connection?.dispose();
      engine?.dispose();
    };
    // Reconnect explicitly replaces the emulator and replays the bounded host buffer.
  }, [api, workspace, info.id, onInfo, revision]);
  return (
    <>
      <p role="status">
        {terminalStatus(info.status)}
        {info.exitCode !== null ? ` · ${t("Exit code")}: ${info.exitCode}` : ""}
      </p>
      {error && <p role="alert">{error}</p>}
      {truncated && (
        <p role="status">
          {t("Older terminal output was discarded. The view resumes from the retained buffer.")}
        </p>
      )}
      <button
        type="button"
        className="ui-button ui-button--secondary"
        onClick={() => {
          replayThrough.current = info.outputEnd;
          setRevision((value) => value + 1);
        }}
      >
        {t("Reconnect terminal")}
      </button>
      <fieldset
        ref={element}
        className="project-terminal-screen"
        aria-label={t("Interactive terminal")}
      />
    </>
  );
}

export function ProjectTerminalPanel({
  workspaceId,
  api,
  directory = "",
  directoryApi,
  onDirectoryChange,
}: {
  workspaceId?: string | null;
  api: TerminalApi;
  directory?: string;
  directoryApi?: Pick<ProjectRunnerApi, "directories">;
  onDirectoryChange?(directory: string): void;
}) {
  const {
    controller,
    sessions,
    selected,
    pending,
    reading,
    loaded,
    readError,
    actionError,
    creationUncertain,
    retryDirectory,
  } = useTerminalSessions(api, workspaceId);
  const onInfo = controller.onInfo;
  const current = sessions.find((item) => item.id === selected);
  return (
    <section
      className="ui-panel project-terminal"
      aria-label={t("Project terminal")}
      aria-busy={pending || reading}
    >
      <h2>{t("Project terminal")}</h2>
      <p>
        {t(
          "An interactive shell runs in your project folder with your host account permissions. Sessions continue when you leave this view and stop when the host exits. Output is kept only in memory.",
        )}
      </p>
      {!api.canUse ? (
        <p>{t("Interactive terminals are available in the desktop app only.")}</p>
      ) : !workspaceId ? (
        <p>{t("Open a project folder to start a terminal.")}</p>
      ) : (
        <>
          {directoryApi && onDirectoryChange ? (
            <TerminalDirectoryPicker
              workspace={workspaceId}
              api={directoryApi}
              directory={directory}
              disabled={pending}
              onChange={onDirectoryChange}
            />
          ) : null}
          <p>
            {t("Directory for new terminals")}: <strong>{directory || t("Workspace root")}</strong>
          </p>
          <div className="project-terminal-actions">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={pending || reading || !loaded || creationUncertain}
              onClick={() => void controller.open(directory)}
            >
              {retryDirectory !== null ? t("Retry terminal start") : t("New terminal")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--secondary"
              disabled={pending || reading}
              onClick={() => void controller.refresh()}
            >
              {t("Refresh terminals")}
            </button>
            {current && (
              <button
                type="button"
                className="ui-button ui-button--danger"
                disabled={pending || current.status !== "running"}
                onClick={() => void controller.stop(current.id)}
              >
                {t("Stop terminal")}
              </button>
            )}
          </div>
          {reading || (!loaded && !readError) ? (
            <p role="status">{t("Reading terminal sessions…")}</p>
          ) : null}
          {actionError && <p role="alert">{actionError}</p>}
          {readError && <p role="alert">{readError}</p>}
          {creationUncertain ? (
            <p role="alert">
              {t(
                "The previous terminal start is unconfirmed and may still complete. Refresh the sessions and review them before opening another terminal.",
              )}
            </p>
          ) : null}
          {!creationUncertain && retryDirectory !== null ? (
            <p role="status">
              {t("The previous terminal start is not in the refreshed list. Retrying uses the same start request for")}{" "}
              <strong>{retryDirectory || t("Workspace root")}</strong>.
            </p>
          ) : null}
          <fieldset className="project-terminal-actions" aria-label={t("Terminal sessions")}>
            {sessions.map((info, index) => (
              <button
                key={info.id}
                type="button"
                className="ui-button ui-button--secondary"
                aria-pressed={selected === info.id}
                onClick={() => controller.select(info.id)}
              >{`${info.shell} ${index + 1} · ${info.directory === undefined ? t("Not reported by this host") : info.directory || t("Workspace root")} · ${terminalStatus(info.status)}`}</button>
            ))}
          </fieldset>
          {current ? <TerminalStartupDetails info={current} /> : null}
          {current && (
            <TerminalSurface
              key={current.id}
              api={api}
              workspace={workspaceId}
              info={current}
              onInfo={onInfo}
            />
          )}
        </>
      )}
    </section>
  );
}
