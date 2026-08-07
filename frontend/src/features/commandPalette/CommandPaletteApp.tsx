import type { PaletteCommand } from "./commandPaletteLogic";

export function CommandPaletteApp({
  commands,
  onRun,
}: {
  commands: PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
}) {
  return (
    <>
      {commands.map((command, index) => (
        <button
          type="button"
          // biome-ignore lint/suspicious/noArrayIndexKey: command catalog has no stable ids
          key={index}
          className="command-item"
          disabled={Boolean(command.disabled)}
          onClick={() => onRun(command)}
        >
          <span className="command-icon">{command.icon ?? "⌘"}</span>
          <span className="command-copy">
            <span className="command-label">
              {command.label ?? "Command"}
            </span>
            <span className="command-desc">{command.desc ?? ""}</span>
          </span>
        </button>
      ))}
    </>
  );
}
