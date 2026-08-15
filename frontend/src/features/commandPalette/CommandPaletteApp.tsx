import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { PaletteCommand } from "./commandPaletteLogic";

export function CommandPaletteApp({
  commands,
  onRun,
}: {
  commands: PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label ?? ""} ${command.desc ?? ""}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
    inputRef.current?.focus();
  }, []);

  const effectiveIndex = Math.min(selectedIndex, Math.max(filtered.length - 1, 0));

  const runSelected = () => {
    const command = filtered[effectiveIndex];
    if (command && !command.disabled) onRun(command);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) =>
        filtered.length ? (index + 1) % filtered.length : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) =>
        filtered.length ? (index - 1 + filtered.length) % filtered.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      runSelected();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        className="command-palette-search"
        placeholder={t("Filter commands")}
        aria-label={t("Filter commands")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="command-palette-results">
        {filtered.map((command, index) => (
          <button
            type="button"
            // biome-ignore lint/suspicious/noArrayIndexKey: command catalog has no stable ids
            key={index}
            className={`command-item${index === effectiveIndex ? " selected" : ""}`}
            disabled={Boolean(command.disabled)}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => onRun(command)}
          >
            <span className="command-icon">{command.icon ?? "⌘"}</span>
            <span className="command-copy">
              <span className="command-label">
                {command.label ?? t("Command")}
              </span>
              <span className="command-desc">{command.desc ?? ""}</span>
            </span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="command-empty">{t("No matching commands")}</p>
        ) : null}
      </div>
      <footer className="command-palette-footer">
        {t("Switch apps: Ctrl+1-9 · Focus input: / · Cancel: Esc")}
      </footer>
    </>
  );
}
