import { useState, type ComponentProps } from "react";
import { t } from "../../shared/i18n";
import { CommandPaletteApp } from "./CommandPaletteApp";
import { ToolCommandPicker, type ToolCommandSource } from "./ToolCommandPicker";

export function CommandPaletteRoot({ tools, ...commands }: ComponentProps<typeof CommandPaletteApp> & { tools?: ToolCommandSource }) {
  const [mode, setMode] = useState("commands");
  return <>
    {tools && <fieldset className="ui-toolbar command-palette-tabs" aria-label={t("Directory type")}>
      <button type="button" className="ui-button ui-button--secondary" aria-pressed={mode === "commands"} onClick={() => setMode("commands")}>{t("Commands")}</button>
      <button type="button" className="ui-button ui-button--secondary" aria-pressed={mode === "tools"} onClick={() => setMode("tools")}>{t("Individual tools")}</button>
    </fieldset>}
    {mode === "tools" && tools ? <ToolCommandPicker {...tools} /> : <CommandPaletteApp {...commands} />}
  </>;
}
