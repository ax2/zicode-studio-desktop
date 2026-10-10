import { t } from "../../shared/i18n";
import type { TerminalInfo } from "./project-terminal";

export function TerminalStartupDetails({ info }: { info: TerminalInfo }) {
  return (
    <>
      <p>
        {t("Terminal startup directory")}:{" "}
        {info.directory === undefined
          ? t("Not reported by this host")
          : info.directory || t("Workspace root")}
      </p>
      <p>
        {t(
          "This is the startup directory. Changing folders inside the shell does not update this label.",
        )}
      </p>
      {info.pythonEnvironment !== undefined ? (
        <p>
          {t("Python environment selected at terminal startup")}:{" "}
          {info.pythonEnvironment || t("No Python environment selected")}
        </p>
      ) : null}
    </>
  );
}
