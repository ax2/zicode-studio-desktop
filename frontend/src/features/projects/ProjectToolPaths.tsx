import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import { type CondaDiscovery, CondaRegistryPicker } from "./CondaRegistryPicker";
import { PoetryEnvironmentPicker } from "./PoetryEnvironmentPicker";
import { normalizeHistory, type ProjectRun, type ProjectRunnerApi } from "./project-runner";

export interface ToolPathSettings {
  revision: number;
  directories: string[];
  pythonEnvironment?: string | null;
}
export interface ToolPathsApi {
  canEdit: boolean;
  read(workspace: string): Promise<ToolPathSettings>;
  save(workspace: string, settings: ToolPathSettings): Promise<ToolPathSettings>;
  pickDirectory?(): Promise<string | null>;
  discoverConda?(workspace: string): Promise<CondaDiscovery>;
}

function poetryEnvironmentPath(run: ProjectRun): string | null {
  if (run.truncated || !run.stdout || run.stdout.length > 4096) return null;
  const lines = run.stdout.trim().split(/\r?\n/);
  if (lines.length !== 1) return null;
  const path = lines[0].trim();
  if (
    !path ||
    [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return null;
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path) ? path : null;
}

export function ProjectToolPaths({
  workspace,
  api,
  runner,
  directory = "",
}: {
  workspace: string;
  api: ToolPathsApi;
  runner?: ProjectRunnerApi;
  directory?: string;
}) {
  const id = useId();
  const generation = useRef(0);
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const busy = useRef(false);
  const [settings, setSettings] = useState<ToolPathSettings | null>(null);
  const [draft, setDraft] = useState("");
  const [pythonDraft, setPythonDraft] = useState("");
  const [customPython, setCustomPython] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [poetryNotice, setPoetryNotice] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    void reload; // Manual reload invalidates the preceding request.
    const current = ++generation.current;
    setSettings(null);
    setDraft("");
    setPythonDraft("");
    setCustomPython(false);
    setError("");
    setSaved(false);
    setRequiresReload(false);
    setPoetryNotice(false);
    busy.current = false;
    setPending(false);
    if (!api.canEdit) return;
    busy.current = true;
    setPending(true);
    void api
      .read(workspace)
      .then(
        (value) => {
          if (generation.current !== current) return;
          setSettings(value);
          setDraft(value.directories.join("\n"));
          setPythonDraft(value.pythonEnvironment || "");
          setCustomPython(Boolean(value.pythonEnvironment));
        },
        () => {
          if (generation.current === current)
            setError(t("Could not load project tool directories. Reload to retry."));
        },
      )
      .finally(() => {
        if (generation.current === current) {
          busy.current = false;
          setPending(false);
        }
      });
    return () => {
      generation.current++;
    };
  }, [workspace, api, reload]);
  async function save() {
    if (!settings || busy.current || !api.canEdit || requiresReload) return;
    const directories = draft
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (directories.length > 8) {
      setError(t("Choose at most eight existing absolute tool directories."));
      return;
    }
    if (customPython && !pythonDraft.trim()) {
      setError(t("Enter the absolute directory of an existing Python venv or Conda environment."));
      return;
    }
    const current = generation.current;
    busy.current = true;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const pythonEnvironment = customPython ? pythonDraft.trim() : null;
      const value = await api.save(workspace, {
        revision: settings.revision,
        directories,
        ...(customPython || settings.pythonEnvironment !== undefined ? { pythonEnvironment } : {}),
      });
      if (generation.current !== current) return;
      setSettings(value);
      setDraft(value.directories.join("\n"));
      setPythonDraft(value.pythonEnvironment || "");
      setCustomPython(Boolean(value.pythonEnvironment));
      setSaved(true);
      setPoetryNotice(false);
    } catch (reason) {
      if (generation.current !== current) return;
      const code = reason instanceof Error ? reason.message : "";
      setRequiresReload(
        !["project_environment_invalid", "project_python_environment_invalid"].includes(code),
      );
      setError(
        code === "project_environment_conflict"
          ? t(
              "Tool directories changed in another window. Your draft is kept; reload the saved configuration before editing again.",
            )
          : code === "project_python_environment_invalid"
            ? t(
                "This Python environment is unavailable or incomplete. Check pyvenv.cfg or conda-meta/history and the Python interpreter.",
              )
            : code === "project_environment_invalid"
              ? t("Choose at most eight existing absolute tool directories.")
              : t(
                  "Could not save tool directories. The result is unconfirmed; reload before trying again.",
                ),
      );
    } finally {
      if (generation.current === current) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  async function chooseDirectory(target: "tool" | "python") {
    if (!api.pickDirectory || busy.current || !settings) return;
    const current = generation.current;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const selected = await api.pickDirectory();
      if (generation.current !== current || selected === null) return;
      if (target === "python") {
        setPythonDraft(selected);
      } else {
        const directories = draft
          .split(/\r?\n/)
          .map((path) => path.trim())
          .filter(Boolean);
        if (directories.includes(selected)) return;
        if (directories.length >= 8) {
          setError(t("Choose at most eight existing absolute tool directories."));
          return;
        }
        setDraft([...directories, selected].join("\n"));
      }
      setSaved(false);
      setPoetryNotice(false);
    } catch {
      if (generation.current === current) setError(t("Could not open the folder picker."));
    } finally {
      if (generation.current === current) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  async function loadPoetryEnvironment() {
    if (
      !runner ||
      !api.canEdit ||
      busy.current ||
      !settings ||
      settings.pythonEnvironment === undefined
    )
      return;
    const current = generation.current;
    const selectedDirectory = directory;
    busy.current = true;
    setPending(true);
    setError("");
    setPoetryNotice(false);
    try {
      const history = normalizeHistory(await runner.runs(workspace));
      if (generation.current !== current || directoryRef.current !== selectedDirectory) return;
      const latest = history.runs
        .filter(
          (run) =>
            run.workspaceId === workspace &&
            run.manager === "poetry" &&
            run.command === "poetry env info --path" &&
            (run.directory || "") === selectedDirectory,
        )
        .sort((left, right) => right.startedAt - left.startedAt)[0];
      const candidate =
        latest?.status === "succeeded" && !latest.historical ? poetryEnvironmentPath(latest) : null;
      if (!candidate) {
        setError(
          t("Run poetry env info --path in Project commands for this directory, then return here."),
        );
        return;
      }
      const catalog = await runner.catalog(workspace, selectedDirectory);
      if (generation.current !== current || directoryRef.current !== selectedDirectory) return;
      if (
        (catalog.directory !== selectedDirectory &&
          (selectedDirectory || catalog.directory !== undefined)) ||
        !latest?.fingerprint ||
        catalog.fingerprint !== latest.fingerprint ||
        !catalog.tasks.some((task) => task.id === "@poetry/environment" && task.runnable)
      ) {
        setError(
          t(
            "Project command configuration changed. Run poetry env info --path again before importing its environment.",
          ),
        );
        return;
      }
      setCustomPython(true);
      setPythonDraft(candidate);
      setSaved(false);
      setPoetryNotice(true);
    } catch {
      if (generation.current === current && directoryRef.current === selectedDirectory)
        setError(
          t(
            "Could not read the latest Poetry environment result. Refresh Project commands and retry.",
          ),
        );
    } finally {
      if (generation.current === current) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return (
    <section
      className="ui-panel project-environment"
      aria-label={t("Project tool directories")}
      aria-busy={pending}
    >
      <h2>{t("Project tool directories")}</h2>
      <p>
        {t(
          "Tool directories are saved on this computer for this project. New commands and terminals search them in order before the host PATH. Existing processes keep their environment.",
        )}
      </p>
      <p>
        {t(
          "Automatic Python selection searches the command folder and its parents up to the workspace root, preferring .venv before .conda in each folder. Project tool directories and host Python follow. An explicit venv or Conda environment overrides it for this project's commands and new terminals. Bundled Pi and Git panels keep their own runtime configuration.",
        )}
      </p>
      {!api.canEdit ? (
        <p>{t("Edit project tool directories from the desktop app.")}</p>
      ) : (
        <>
          <label htmlFor={id}>{t("Absolute tool directories, one per line")}</label>
          <textarea
            id={id}
            className="ui-textarea"
            rows={5}
            value={draft}
            disabled={pending || !settings}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
          />
          {api.pickDirectory ? (
            <button
              type="button"
              className="ui-button ui-button--secondary"
              disabled={pending || !settings}
              onClick={() => void chooseDirectory("tool")}
            >
              {t("Add tool directory")}
            </button>
          ) : null}
          <p>
            {t(
              "Only add directories whose programs you trust. An empty tool list removes extra tool paths; Python selection is configured separately below.",
            )}
          </p>
          <label htmlFor={`${id}-python-mode`}>{t("Python environment (venv or Conda)")}</label>
          <select
            id={`${id}-python-mode`}
            className="ui-select"
            disabled={pending || !settings || settings.pythonEnvironment === undefined}
            value={customPython ? "custom" : "automatic"}
            onChange={(event) => {
              setCustomPython(event.target.value === "custom");
              setSaved(false);
              setPoetryNotice(false);
            }}
          >
            <option value="automatic">{t("Automatic Python selection")}</option>
            <option value="custom">{t("Use an existing Python environment")}</option>
          </select>
          <p>
            {t("Saving applies both the tool directories and the Python environment selection.")}
          </p>
          {settings && settings.pythonEnvironment === undefined ? (
            <p>{t("Update the desktop host to select a Python environment.")}</p>
          ) : null}
          {runner?.canRun ? (
            <button
              type="button"
              className="ui-button ui-button--secondary"
              disabled={pending || !settings || settings.pythonEnvironment === undefined}
              onClick={() => void loadPoetryEnvironment()}
            >
              {t("Use latest Poetry environment")}
            </button>
          ) : null}
          {api.discoverConda && settings?.pythonEnvironment !== undefined ? (
            <CondaRegistryPicker
              key={workspace}
              workspace={workspace}
              discover={api.discoverConda}
              disabled={pending || !settings}
              onSelect={(path) => {
                setCustomPython(true);
                setPythonDraft(path);
                setSaved(false);
                setPoetryNotice(false);
              }}
            />
          ) : null}
          {runner?.canRun && settings?.pythonEnvironment !== undefined ? (
            <PoetryEnvironmentPicker
              key={`${workspace}:${directory}`}
              workspace={workspace}
              directory={directory}
              runner={runner}
              disabled={pending || !settings}
              onSelect={(path) => {
                setCustomPython(true);
                setPythonDraft(path);
                setSaved(false);
                setPoetryNotice(true);
              }}
            />
          ) : null}
          {poetryNotice ? (
            <p role="status">
              {t("Poetry environment path added to the draft. Save to validate and apply it.")}
            </p>
          ) : null}
          {customPython ? (
            <>
              <label htmlFor={`${id}-python-path`}>
                {t("Absolute Python environment directory")}
              </label>
              <input
                id={`${id}-python-path`}
                className="ui-input"
                type="text"
                spellCheck={false}
                value={pythonDraft}
                disabled={pending || !settings}
                onChange={(event) => {
                  setPythonDraft(event.target.value);
                  setSaved(false);
                  setPoetryNotice(false);
                }}
              />
              {api.pickDirectory ? (
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  disabled={pending || !settings}
                  onClick={() => void chooseDirectory("python")}
                >
                  {t("Choose Python environment folder")}
                </button>
              ) : null}
              <p>
                {t(
                  "Select a venv directory containing pyvenv.cfg or a Conda prefix containing conda-meta/history. Saving validates the directory without installing packages or running activation scripts.",
                )}
              </p>
              <p>
                {t(
                  "Conda activation hooks and variables saved with conda env config vars are not loaded. If your environment needs them, activate it explicitly in a terminal.",
                )}
              </p>
            </>
          ) : null}
          <div className="ui-toolbar">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={pending || !settings || requiresReload}
              onClick={() => void save()}
            >
              {t("Save tool directories")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--secondary"
              disabled={pending}
              onClick={() => setReload((value) => value + 1)}
            >
              {t("Reload saved tool directories")}
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <p role="status">
            {pending
              ? t("Loading or saving tool directories…")
              : saved
                ? t("Tool directories saved. Environment results are being refreshed.")
                : ""}
          </p>
        </>
      )}
    </section>
  );
}
