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
          key={index}
          type="button"
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
