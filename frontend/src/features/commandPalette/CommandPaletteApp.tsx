import { useEffect, useMemo, useRef, useState } from "react";
import { matchesSearchTerms, prepareSearchQuery } from "../../shared/catalog-search";
import { t } from "../../shared/i18n";
import { isImeComposing } from "../../shared/ime";
import type { PaletteCommand } from "./commandPaletteLogic";
import { nextEnabledIndex, pageEnabledIndex } from "./palette-navigation";
import { type AccessView, ToolAccessControls } from "./ToolAccessControls";
import { accessCommands, type ToolAccessScope, type ToolAccessStore } from "./tool-access";
import { useCommandWindow } from "./use-command-window";
import { useToolAccess } from "./use-tool-access";

export function CommandPaletteApp({
  commands,
  onRun,
  accessStore,
  scope,
}: {
  commands: PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
  accessStore?: ToolAccessStore;
  scope?: ToolAccessScope;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<AccessView>("all");
  const access = useToolAccess(accessStore, scope);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  const filtered = useMemo(() => {
    const terms = prepareSearchQuery(query);
    const visible = accessCommands(commands, access.state, view);
    if (!terms.length) return visible;
    return visible.filter((command) =>
      matchesSearchTerms(terms, [command.label, command.desc, ...(command.keywords ?? [])]),
    );
  }, [commands, query, access.state, view]);

  useEffect(() => {
    setSelectedIndex(0);
    inputRef.current?.focus();
  }, []);

  const effectiveIndex =
    filtered[selectedIndex] && !filtered[selectedIndex].disabled
      ? selectedIndex
      : nextEnabledIndex(filtered, -1, 1);

  const window = useCommandWindow(filtered, effectiveIndex, resultsRef);

  const runSelected = () => {
    const command = filtered[effectiveIndex];
    if (command && !command.disabled && window.selectedVisible) onRun(command);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event, composingRef.current)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex(nextEnabledIndex(filtered, window.navigationStart(1), 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex(nextEnabledIndex(filtered, window.navigationStart(-1), -1));
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const direction = event.key === "PageDown" ? 1 : -1;
      const current = window.selectedVisible ? effectiveIndex : nextEnabledIndex(filtered, window.navigationStart(direction), direction);
      setSelectedIndex(pageEnabledIndex(filtered, current, direction));
    } else if ((event.ctrlKey || event.metaKey) && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setSelectedIndex(nextEnabledIndex(filtered, -1, event.key === "Home" ? 1 : -1));
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
        role="combobox"
        aria-expanded="true"
        aria-controls="command-palette-results"
        aria-activedescendant={window.selectedMounted ? `command-item-${effectiveIndex}` : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelectedIndex(0);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={onKeyDown}
      />
      {accessStore && scope && <ToolAccessControls
        view={view} onView={(next) => { setView(next); setSelectedIndex(0); inputRef.current?.focus(); }}
        access={access} selected={window.selectedVisible ? filtered[effectiveIndex] : undefined}
        unavailable={access.state.favorites.filter(id => !commands.some(command => command.id === id))}
      />}
      <p className="command-palette-count" role="status" aria-live="polite" aria-atomic="true">
        {t("{matched} / {total} commands").replace("{matched}", String(filtered.length)).replace("{total}", String(commands.length))}
      </p>
      <div
        className="command-palette-results"
        id="command-palette-results"
        ref={resultsRef}
        role="listbox"
        aria-label={t("Filter commands")}
        onScroll={window.onScroll}
      >
        <div aria-hidden="true" style={{ height: window.before }} />
        {filtered.slice(window.start, window.end).map((command, offset) => {
          const index = window.start + offset;
          return (
          <button
            type="button"
            key={command.id ?? index}
            id={`command-item-${index}`}
            role="option"
            aria-selected={index === effectiveIndex}
            aria-setsize={filtered.length}
            aria-posinset={index + 1}
            title={[command.label, command.desc].filter(Boolean).join(" — ")}
            className={`command-item${index === effectiveIndex ? " selected" : ""}`}
            disabled={Boolean(command.disabled)}
            onMouseEnter={() => {
              if (!command.disabled) setSelectedIndex(index);
            }}
            onClick={() => onRun(command)}
          >
            <span className="command-icon">{command.icon ?? "⌘"}</span>
            <span className="command-copy">
              <span className="command-label">{command.label ?? t("Command")}</span>
              <span className="command-desc">{command.desc ?? ""}</span>
            </span>
          </button>
          );
        })}
        <div aria-hidden="true" style={{ height: window.after }} />
        {filtered.length === 0 ? (
          <p className="command-empty">{t("No matching commands")}</p>
        ) : null}
      </div>
      <footer className="command-palette-footer">
        <span>{t("Navigate: ↑↓ · Page: PgUp/PgDn · Run: Enter")}</span>
        <span>
        {t("Switch apps: Ctrl+1-9 · Focus input: / · Cancel: Esc")}
        </span>
      </footer>
    </>
  );
}
