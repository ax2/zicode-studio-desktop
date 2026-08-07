export interface PaletteCommand {
  icon?: string;
  label?: string;
  desc?: string;
  disabled?: boolean;
  action?: () => unknown;
}

export type PaletteCommandSource = (() => PaletteCommand[]) | PaletteCommand[];

export function resolveCommands(source: PaletteCommandSource): PaletteCommand[] {
  return (typeof source === "function" ? source() : source) ?? [];
}
